const express = require('express');
const crypto = require('crypto');
const { User, Inventory, Gold } = require('../models/database');
const { userGold, inventories, saveDatabase } = require('../utils/gameUtils');

const router = express.Router();

// UUID 생성 함수
function generateUUID() {
  return crypto.randomUUID();
}

// 회원가입 API
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '사용자 이름과 비밀번호를 모두 입력해야 합니다.' });
  }
  
  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ success: false, message: '이미 존재하는 사용자 이름입니다.' });
    }
    
    const uuid = generateUUID();
    const user = new User({ username, password, uuid });
    await user.save();
    
    // 새 사용자를 위한 인벤토리 및 골드 초기화
    const inventory = new Inventory({ userId: uuid, items: {} });
    const gold = new Gold({ userId: uuid, amount: 0 });
    
    await inventory.save();
    await gold.save();
    
    // 메모리에도 추가
    inventories.set(uuid, {});
    userGold.set(uuid, 0);
    
    return res.status(201).json({ success: true, message: '회원가입이 완료되었습니다.', uuid });
  } catch (e) {
    console.error('회원가입 에러:', e);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 로그인 API
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '사용자 이름과 비밀번호를 모두 입력해야 합니다.' });
  }
  
  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: '존재하지 않는 사용자입니다.' });
    }
    
    if (user.password !== password) {
      return res.status(401).json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
    }
    
    return res.status(200).json({ 
      success: true, 
      message: '로그인이 완료되었습니다.', 
      uuid: user.uuid,
      username: username
    });
  } catch (e) {
    console.error('로그인 에러:', e);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router; 