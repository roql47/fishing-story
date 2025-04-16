const express = require('express');
const router = express.Router();
const { User, Inventory, Gold } = require('../models/database');
const { 
  inventories, userGold, equippedRod, equippedAccessory, rodEnhancement,
  fishingSkills, lastFishingTime, autoEquip, saveDatabase
} = require('../utils/gameUtils');
const { fishTypes, rodNames, accessoryNames } = require('../data/gameData');

// 낚시 결과 조회 API
router.get('/result/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // 사용자 존재 여부 확인
    const user = await User.findOne({ uuid: userId });
    if (!user) {
      return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
    }
    
    // 사용자 인벤토리 정보
    const userInventory = inventories.get(userId) || {};
    const fishCount = Object.keys(userInventory).filter(item => 
      fishTypes.some(fish => fish.name === item)
    ).length;
    
    // 수집률 계산
    const totalFishTypes = fishTypes.length;
    const collectionRate = Math.floor((fishCount / totalFishTypes) * 100);
    
    // 낚시 스킬 레벨
    const skillLevel = fishingSkills.get(userId) || 0;
    
    // 장착된 장비
    const currentRod = equippedRod.get(userId) || rodNames[0];
    const currentAccessory = equippedAccessory.get(userId) || accessoryNames[0];
    
    // 강화 수치
    const enhancement = rodEnhancement.get(userId) || 0;
    
    // 소지 골드
    const gold = userGold.get(userId) || 0;
    
    return res.status(200).json({
      uuid: userId,
      username: user.username,
      gold,
      fishingSkill: skillLevel,
      collectedFish: fishCount,
      totalFishTypes,
      collectionRate,
      equipment: {
        rod: currentRod,
        accessory: currentAccessory,
        enhancement
      },
      lastFishingTime: lastFishingTime.get(userId) || 0
    });
  } catch (error) {
    console.error('낚시 결과 조회 오류:', error);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// 낚시대 강화 API
router.post('/enhance', async (req, res) => {
  try {
    const { userId, material, count } = req.body;
    
    if (!userId || !material || !count) {
      return res.status(400).json({ message: '필수 파라미터가 누락되었습니다.' });
    }
    
    // 사용자 존재 여부 확인
    const user = await User.findOne({ uuid: userId });
    if (!user) {
      return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
    }
    
    // 인벤토리 확인
    const inv = inventories.get(userId) || {};
    const materialCount = inv[material] || 0;
    
    if (materialCount < count) {
      return res.status(400).json({ 
        message: `${material}이(가) 부족합니다. 필요: ${count}, 보유: ${materialCount}` 
      });
    }
    
    // 장착된 낚시대 확인
    const currentRod = equippedRod.get(userId);
    if (!currentRod || currentRod === rodNames[0]) {
      return res.status(400).json({ message: '강화할 낚시대가 없습니다.' });
    }
    
    // 현재 강화 수치
    let currentEnhancement = rodEnhancement.get(userId) || 0;
    
    // 강화 성공 확률 계산 (수치가 높을수록 성공 확률 감소)
    const baseSuccessRate = 90; // 기본 90%
    const successRate = Math.max(10, baseSuccessRate - (currentEnhancement * 10)); // 최소 10%
    
    // 성공 여부 판단
    const isSuccess = Math.random() * 100 < successRate;
    
    // 재료 소비
    inv[material] -= count;
    if (inv[material] <= 0) delete inv[material];
    inventories.set(userId, inv);
    
    if (isSuccess) {
      // 성공: 강화 수치 증가
      rodEnhancement.set(userId, currentEnhancement + 1);
      
      // 메모리와 DB 동기화
      await Inventory.updateOne(
        { userId: user._id },
        { $set: { items: inv } }
      );
      
      await saveDatabase();
      
      return res.status(200).json({
        success: true,
        message: '강화에 성공했습니다!',
        newEnhancement: currentEnhancement + 1,
        rod: currentRod
      });
    } else {
      // 실패: 재료만 소비됨
      await Inventory.updateOne(
        { userId: user._id },
        { $set: { items: inv } }
      );
      
      await saveDatabase();
      
      return res.status(200).json({
        success: false,
        message: '강화에 실패했습니다.',
        enhancementLevel: currentEnhancement,
        rod: currentRod
      });
    }
  } catch (error) {
    console.error('낚시대 강화 오류:', error);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// 어항 기능 API (물고기 전시)
router.post('/aquarium/set', async (req, res) => {
  try {
    const { userId, fishName } = req.body;
    
    if (!userId || !fishName) {
      return res.status(400).json({ message: '필수 파라미터가 누락되었습니다.' });
    }
    
    // 사용자 존재 여부 확인
    const user = await User.findOne({ uuid: userId });
    if (!user) {
      return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
    }
    
    // 물고기 존재 여부 확인
    const fish = fishTypes.find(f => f.name === fishName);
    if (!fish) {
      return res.status(404).json({ message: '존재하지 않는 물고기입니다.' });
    }
    
    // 인벤토리 확인
    const inv = inventories.get(userId) || {};
    if (!inv[fishName] || inv[fishName] <= 0) {
      return res.status(400).json({ message: `${fishName}을(를) 보유하고 있지 않습니다.` });
    }
    
    // 어항에 물고기 설정
    user.aquarium = fishName;
    await user.save();
    
    return res.status(200).json({
      success: true,
      message: `${fishName}을(를) 어항에 전시했습니다.`,
      aquarium: fishName
    });
  } catch (error) {
    console.error('어항 설정 오류:', error);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// 어항 물고기 조회 API
router.get('/aquarium/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // 사용자 존재 여부 확인
    const user = await User.findOne({ uuid: userId });
    if (!user) {
      return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
    }
    
    return res.status(200).json({
      success: true,
      aquarium: user.aquarium || null
    });
  } catch (error) {
    console.error('어항 조회 오류:', error);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// 낚시대 장착 API
router.post('/equip', async (req, res) => {
  try {
    const { userId, itemType, itemName } = req.body;
    
    if (!userId || !itemType || !itemName) {
      return res.status(400).json({ message: '필수 파라미터가 누락되었습니다.' });
    }
    
    // 사용자 존재 여부 확인
    const user = await User.findOne({ uuid: userId });
    if (!user) {
      return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
    }
    
    // 인벤토리 확인
    const inv = inventories.get(userId) || {};
    if (!inv[itemName] || inv[itemName] <= 0) {
      return res.status(400).json({ message: `${itemName}을(를) 보유하고 있지 않습니다.` });
    }
    
    // 아이템 타입 확인 및 장착
    if (itemType === 'rod') {
      // 유효한 낚시대인지 확인
      const isValidRod = Object.values(rodNames).includes(itemName);
      if (!isValidRod) {
        return res.status(400).json({ message: '유효하지 않은 낚시대입니다.' });
      }
      
      equippedRod.set(userId, itemName);
    } else if (itemType === 'accessory') {
      // 유효한 악세사리인지 확인
      const isValidAccessory = Object.values(accessoryNames).includes(itemName);
      if (!isValidAccessory) {
        return res.status(400).json({ message: '유효하지 않은 악세사리입니다.' });
      }
      
      equippedAccessory.set(userId, itemName);
    } else {
      return res.status(400).json({ message: '유효하지 않은 아이템 타입입니다. rod 또는 accessory만 가능합니다.' });
    }
    
    // 데이터베이스 저장
    await saveDatabase();
    
    return res.status(200).json({
      success: true,
      message: `${itemName}을(를) 장착했습니다.`,
      equipped: {
        rod: equippedRod.get(userId) || rodNames[0],
        accessory: equippedAccessory.get(userId) || accessoryNames[0]
      }
    });
  } catch (error) {
    console.error('장비 장착 오류:', error);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router; 