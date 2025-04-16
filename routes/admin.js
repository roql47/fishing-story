const express = require('express');
const { User, Inventory, Gold } = require('../models/database');
const { userGold, inventories, saveDatabase, autoEquip, formatPrice } = require('../utils/gameUtils');
const { fishTypes, rodNames, accessoryNames, ADMIN_KEY } = require('../data/gameData');

const router = express.Router();

// 관리자 골드 수정 API
router.post('/gold', async (req, res) => {
  const { username, amount, adminKey } = req.body;
  
  // 관리자 키 확인
  if (adminKey !== ADMIN_KEY) {
    return res.status(401).json({ success: false, message: '관리자 권한이 없습니다.' });
  }
  
  if (!username || amount === undefined) {
    return res.status(400).json({ success: false, message: '사용자 이름과 골드 수량을 모두 입력해야 합니다.' });
  }
  
  try {
    // 사용자 찾기
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: '존재하지 않는 사용자입니다.' });
    }
    
    // 골드 수정
    await Gold.findOneAndUpdate(
      { userId: user.uuid },
      { amount: parseInt(amount) },
      { upsert: true }
    );
    
    // 메모리에도 반영
    userGold.set(user.uuid, parseInt(amount));
    
    return res.status(200).json({ 
      success: true, 
      message: `${username} 사용자의 골드가 ${formatPrice(parseInt(amount))}원으로 변경되었습니다.`
    });
  } catch (e) {
    console.error('골드 수정 에러:', e);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 관리자 물고기 지급 API
router.post('/fish', async (req, res) => {
  const { username, fishName, quantity, adminKey } = req.body;
  
  // 관리자 키 확인
  if (adminKey !== ADMIN_KEY) {
    return res.status(401).json({ success: false, message: '관리자 권한이 없습니다.' });
  }
  
  if (!username || !fishName || !quantity) {
    return res.status(400).json({ success: false, message: '사용자 이름, 물고기 이름, 수량을 모두 입력해야 합니다.' });
  }
  
  try {
    // 사용자 찾기
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: '존재하지 않는 사용자입니다.' });
    }
    
    // 물고기 확인
    const fish = fishTypes.find(f => f.name === fishName);
    if (!fish) {
      return res.status(404).json({ success: false, message: '존재하지 않는 물고기입니다.' });
    }
    
    // 인벤토리 가져오기
    let inventory = await Inventory.findOne({ userId: user.uuid });
    if (!inventory) {
      inventory = new Inventory({ userId: user.uuid, items: new Map() });
    }
    
    // 메모리에서 인벤토리 처리
    const userInventory = inventories.get(user.uuid) || {};
    userInventory[fishName] = (userInventory[fishName] || 0) + parseInt(quantity);
    inventories.set(user.uuid, userInventory);
    
    // DB에 저장 (Map 타입으로 변환)
    const items = inventory.items || new Map();
    items.set(fishName, (items.get(fishName) || 0) + parseInt(quantity));
    
    await Inventory.findOneAndUpdate(
      { userId: user.uuid },
      { userId: user.uuid, items },
      { upsert: true }
    );
    
    return res.status(200).json({ 
      success: true, 
      message: `${username} 사용자에게 ${fishName} ${quantity}개가 지급되었습니다.`
    });
  } catch (e) {
    console.error('물고기 지급 에러:', e);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 관리자 낚시대 지급 API
router.post('/rod', async (req, res) => {
  const { username, rodName, quantity, adminKey } = req.body;
  
  // 관리자 키 확인
  if (adminKey !== ADMIN_KEY) {
    return res.status(401).json({ success: false, message: '관리자 권한이 없습니다.' });
  }
  
  if (!username || !rodName || !quantity) {
    return res.status(400).json({ success: false, message: '사용자 이름, 낚시대 이름, 수량을 모두 입력해야 합니다.' });
  }
  
  // 낚시대 확인
  let validRod = false;
  for (const key in rodNames) {
    if (rodNames[key] === rodName) {
      validRod = true;
      break;
    }
  }
  
  if (!validRod) {
    return res.status(404).json({ success: false, message: '존재하지 않는 낚시대입니다.' });
  }
  
  try {
    // 사용자 찾기
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: '존재하지 않는 사용자입니다.' });
    }
    
    // 인벤토리 가져오기
    let inventory = await Inventory.findOne({ userId: user.uuid });
    if (!inventory) {
      inventory = new Inventory({ userId: user.uuid, items: new Map() });
    }
    
    // 메모리에서 인벤토리 처리
    const userInventory = inventories.get(user.uuid) || {};
    userInventory[rodName] = (userInventory[rodName] || 0) + parseInt(quantity);
    inventories.set(user.uuid, userInventory);
    
    // DB에 저장 (Map 타입으로 변환)
    const items = inventory.items || new Map();
    items.set(rodName, (items.get(rodName) || 0) + parseInt(quantity));
    
    await Inventory.findOneAndUpdate(
      { userId: user.uuid },
      { userId: user.uuid, items },
      { upsert: true }
    );
    
    // 자동 장착 수행
    autoEquip(user.uuid);
    
    return res.status(200).json({ 
      success: true, 
      message: `${username} 사용자에게 ${rodName} ${quantity}개가 지급되었습니다.`
    });
  } catch (e) {
    console.error('낚시대 지급 에러:', e);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 관리자 악세사리 지급 API
router.post('/accessory', async (req, res) => {
  const { username, accessoryName, quantity, adminKey } = req.body;
  
  // 관리자 키 확인
  if (adminKey !== ADMIN_KEY) {
    return res.status(401).json({ success: false, message: '관리자 권한이 없습니다.' });
  }
  
  if (!username || !accessoryName || !quantity) {
    return res.status(400).json({ success: false, message: '사용자 이름, 악세사리 이름, 수량을 모두 입력해야 합니다.' });
  }
  
  // 악세사리 확인
  let validAccessory = false;
  for (const key in accessoryNames) {
    if (accessoryNames[key] === accessoryName) {
      validAccessory = true;
      break;
    }
  }
  
  if (!validAccessory) {
    return res.status(404).json({ success: false, message: '존재하지 않는 악세사리입니다.' });
  }
  
  try {
    // 사용자 찾기
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: '존재하지 않는 사용자입니다.' });
    }
    
    // 인벤토리 가져오기
    let inventory = await Inventory.findOne({ userId: user.uuid });
    if (!inventory) {
      inventory = new Inventory({ userId: user.uuid, items: new Map() });
    }
    
    // 메모리에서 인벤토리 처리
    const userInventory = inventories.get(user.uuid) || {};
    userInventory[accessoryName] = (userInventory[accessoryName] || 0) + parseInt(quantity);
    inventories.set(user.uuid, userInventory);
    
    // DB에 저장 (Map 타입으로 변환)
    const items = inventory.items || new Map();
    items.set(accessoryName, (items.get(accessoryName) || 0) + parseInt(quantity));
    
    await Inventory.findOneAndUpdate(
      { userId: user.uuid },
      { userId: user.uuid, items },
      { upsert: true }
    );
    
    // 자동 장착 수행
    autoEquip(user.uuid);
    
    return res.status(200).json({ 
      success: true, 
      message: `${username} 사용자에게 ${accessoryName} ${quantity}개가 지급되었습니다.`
    });
  } catch (e) {
    console.error('악세사리 지급 에러:', e);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router; 
