const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { User, Inventory, Gold, ChatLog, isConnected, connectToMongoDB } = require('./models/database');
const userRouter = require('./routes/user');
const adminRouter = require('./routes/admin');
const fishingRouter = require('./routes/fishing');

// MongoDB 연결 설정
let mongoConnected = false;

// 초기 연결 시도
connectToMongoDB();

// 연결 끊김 감지 및 재연결
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB 연결이 끊어졌습니다. 재연결을 시도합니다...');
  mongoConnected = false;
  setTimeout(connectToMongoDB, 5000);
});

const app = express();
// 정적 파일 제공 설정
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// 루트 경로에 대한 GET 요청 처리
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client.html'));
});

// 관리자 페이지 접근 경로
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Map: WebSocket → { userId, nickname, room }
const clients = new Map();
// Map: userId → { 물고기명: 개수 }
const inventories = new Map();
// Map: userId → 골드 (숫자)
const userGold = new Map();
// Map: username → { password, uuid }
const users = new Map();

// 물고기 종류 정보
const fishTypes = [
  { name: '타코문어', price: 300, material: "문어다리" },
  { name: '풀고등어', price: 700, material: "고등어비늘" },
  { name: '경단붕어', price: 1500, material: "당고" },
  { name: '버터오징어', price: 8000, material: "버터조각" },
  { name: '간장새우', price: 15000, material: "간장종지" },
  { name: '물수수', price: 30000, material: "옥수수콘" },
  { name: '정어리파이', price: 40000, material: "버터" },
  { name: '얼음상어', price: 50000, material: "얼음조각" },
  { name: '스퀄스퀴드', price: 60000, material: "오징어먹물" },
  { name: '백년송거북', price: 100000, material: "백년송" },
  { name: '고스피쉬', price: 150000, material: "후춧가루" },
  { name: '유령치', price: 230000, material: "석화" },
  { name: '바이트독', price: 470000, material: "핫소스" },
  { name: '호박고래', price: 700000, material: "펌킨조각" },
  { name: '바이킹조개', price: 1250000, material: "꽃술" },
  { name: '천사해파리', price: 2440000, material: "프레첼" },
  { name: '악마복어', price: 4100000, material: "베놈" },
  { name: '칠성장어', price: 6600000, material: "장어꼬리" },
  { name: '닥터블랙', price: 9320000, material: "아인스바인" },
  { name: '해룡', price: 14400000, material: "헤븐즈서펀트" },
  { name: '메카핫킹크랩', price: 27950000, material: "집게다리" },
  { name: '램프리', price: 46400000, material: "이즈니버터" },
  { name: '마지막잎새', price: 76500000, material: "라벤더오일" },
  { name: '아이스브리더', price: 131200000, material: "샤베트" },
  { name: '해신', price: 288000000, material: "마법의정수" },
  { name: '핑키피쉬', price: 418600000, material: "휘핑크림" },
  { name: '콘토퍼스', price: 731560000, material: "와플리머신" },
  { name: '딥원', price: 1026400000, material: "베르쥬스" },
  { name: '큐틀루', price: 1477500000, material: "안쵸비" },
  { name: '꽃술나리', price: 2092000000, material: "핑크멜로우" },
  { name: '다무스', price: 2633200000, material: "와일드갈릭" },
  { name: '수호자', price: 3427900000, material: "그루누아" },
  { name: '태양가사리', price: 6483100000, material: "시더플랭크" },
  { name: '빅파더펭귄', price: 9887600000, material: "세비체" },
  { name: '크레인터틀', price: 15124000000, material: "타파스" },
  { name: 'CSP-765 조립식생선', price: 19580000000, material: "트러플리소토" },
  { name: '데드케이지', price: 25420000000, material: "캐비아소스" },
  { name: '다크암모나이트', price: 31780000000, material: "푸아그라에스푸마" },
  { name: '조가비여인', price: 38240000000, material: "샴페인젤리" },
  { name: '10개통고래', price: 45360000000, material: "금박마카롱" },
  { name: '스타피쉬', price: 100, material: "별조각" }
];

// 낚시 확률 배열 (물고기 선택 시 사용)
const catchProbabilities = [38.5, 25, 15, 8, 5, 3, 2, 1, 0.7, 0.3, 1];

// 낚시대 종류 및 가격
const rodData = {
  "맨손": { price: 0, requires: null, fishingSkill: 0 },
  "낡은낚시대": { price: 10000, requires: null, fishingSkill: 1 },
  "일반낚시대": { price: 60000, requires: "낡은낚시대", fishingSkill: 2 },
  "단단한낚시대": { price: 140000, requires: "일반낚시대", fishingSkill: 3 },
  "은낚시대": { price: 370000, requires: "단단한낚시대", fishingSkill: 4 },
  "금낚시대": { price: 820000, requires: "은낚시대", fishingSkill: 5 },
  "강철낚시대": { price: 2390000, requires: "금낚시대", fishingSkill: 6 },
  "사파이어낚시대": { price: 6100000, requires: "강철낚시대", fishingSkill: 7 },
  "루비낚시대": { price: 15000000, requires: "사파이어낚시대", fishingSkill: 8 },
  "다이아몬드낚시대": { price: 45000000, requires: "루비낚시대", fishingSkill: 9 },
  "레드다이아몬드낚시대": { price: 100000000, requires: "다이아몬드낚시대", fishingSkill: 10 },
  "벚꽃낚시대": { price: 300000000, requires: "레드다이아몬드낚시대", fishingSkill: 11 },
  "꽃망울낚시대": { price: 732000000, requires: "벚꽃낚시대", fishingSkill: 12 },
  "호롱불낚시대": { price: 1980000000, requires: "꽃망울낚시대", fishingSkill: 13 },
  "산호등낚시대": { price: 4300000000, requires: "호롱불낚시대", fishingSkill: 14 },
  "피크닉": { price: 8800000000, requires: "산호등낚시대", fishingSkill: 15 },
  "마녀빗자루": { price: 25000000000, requires: "피크닉", fishingSkill: 16 },
  "에테르낚시대": { price: 64800000000, requires: "마녀빗자루", fishingSkill: 17 },
  "별조각낚시대": { price: 147600000000, requires: "에테르낚시대", fishingSkill: 18 },
  "여우꼬리낚시대": { price: 320000000000, requires: "별조각낚시대", fishingSkill: 19 },
  "초콜릿롤낚시대": { price: 780000000000, requires: "여우꼬리낚시대", fishingSkill: 20 },
  "호박유령낚시대": { price: 2800000000000, requires: "초콜릿롤낚시대", fishingSkill: 21 },
  "핑크버니낚시대": { price: 6100000000000, requires: "호박유령낚시대", fishingSkill: 22 },
  "할로우낚시대": { price: 15100000000000, requires: "핑크버니낚시대", fishingSkill: 23 },
  "여우불낚시대": { price: 40400000000000, requires: "할로우낚시대", fishingSkill: 24 }
};

// 악세서리 데이터
const accessoryData = {
  "없음": { price: 0, requires: null, fishingSkill: 0 },
  "오래된반지": { price: 8000, requires: null, fishingSkill: 0, cooldownReduction: 15000, sellBonus: 0.05 },
  "은목걸이": { price: 32000, requires: "오래된반지", fishingSkill: 0, cooldownReduction: 30000, sellBonus: 0.1 },
  "금귀걸이": { price: 72000, requires: "은목걸이", fishingSkill: 0, cooldownReduction: 45000, sellBonus: 0.15 },
  "마법의펜던트": { price: 128000, requires: "금귀걸이", fishingSkill: 0, cooldownReduction: 60000, sellBonus: 0.2 },
  "에메랄드브로치": { price: 200000, requires: "마법의펜던트", fishingSkill: 0, cooldownReduction: 75000, sellBonus: 0.25 },
  "토파즈이어링": { price: 360000, requires: "에메랄드브로치", fishingSkill: 0, cooldownReduction: 90000, sellBonus: 0.3 },
  "자수정팔찌": { price: 640000, requires: "토파즈이어링", fishingSkill: 0, cooldownReduction: 105000, sellBonus: 0.35 },
  "백금티아라": { price: 980000, requires: "자수정팔찌", fishingSkill: 0, cooldownReduction: 120000, sellBonus: 0.4 },
  "만드라고라허브": { price: 1400000, requires: "백금티아라", fishingSkill: 0, cooldownReduction: 135000, sellBonus: 0.45 },
  "에테르나무묘목": { price: 2000000, requires: "만드라고라허브", fishingSkill: 0, cooldownReduction: 150000, sellBonus: 0.5 },
  "몽마의조각상": { price: 3800000, requires: "에테르나무묘목", fishingSkill: 0, cooldownReduction: 165000, sellBonus: 0.55 },
  "마카롱훈장": { price: 6400000, requires: "몽마의조각상", fishingSkill: 0, cooldownReduction: 180000, sellBonus: 0.6 },
  "빛나는마력순환체": { price: 10000000, requires: "마카롱훈장", fishingSkill: 0, cooldownReduction: 210000, sellBonus: 0.8 }
};

// 포맷 가격 유틸리티 함수
function formatPrice(price) {
  // price가 undefined, null일 경우 0을 기본값으로 사용
  price = price != null ? price : 0;
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const DB_FILE = path.join(__dirname, 'db.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// UUID 생성 함수
function generateUUID() {
  return crypto.randomUUID();
}

// 유저 데이터베이스에서 기존 유저 데이터를 불러오기
async function loadUsers() {
  try {
    const usersData = await User.find({});
    for (const user of usersData) {
      users.set(user.username, {
        password: user.password,
        uuid: user.uuid
      });
    }
    console.log('유저 데이터베이스 로드 완료');
  } catch (e) {
    console.error("유저 데이터베이스 로드 에러:", e);
  }
}

// 유저 데이터 저장
async function saveUsers() {
  try {
    for (const [username, data] of users) {
      await User.findOneAndUpdate(
        { username },
        { username, password: data.password, uuid: data.uuid },
        { upsert: true }
      );
    }
  } catch (e) {
    console.error("유저 데이터베이스 저장 에러:", e);
  }
}

// 회원가입 API
app.post('/api/register', async (req, res) => {
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
    users.set(username, { password, uuid });
    inventories.set(uuid, {});
    userGold.set(uuid, 0);
    
    return res.status(201).json({ success: true, message: '회원가입이 완료되었습니다.', uuid });
  } catch (e) {
    console.error('회원가입 에러:', e);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 로그인 API
app.post('/api/login', async (req, res) => {
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
    
    // 메모리에도 추가
    users.set(username, { password: user.password, uuid: user.uuid });
    
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

// 데이터베이스에서 기존 데이터를 불러오기
async function loadDatabase() {
  try {
    // 인벤토리 불러오기
    const inventoriesData = await Inventory.find({});
    
    for (const inv of inventoriesData) {
      // Map 형태로 변환하여 메모리에 저장
      const items = {};
      if (inv.items && inv.items instanceof Map) {
        for (const [key, value] of inv.items.entries()) {
          items[key] = value;
        }
      } else if (inv.items && typeof inv.items === 'object') {
        // 기존 데이터가 객체 형태일 경우
        Object.assign(items, inv.items);
      }
      inventories.set(inv.userId, items);
    }
    
    // 골드 불러오기
    const goldsData = await Gold.find({});
    
    for (const gold of goldsData) {
      userGold.set(gold.userId, gold.amount);
    }
    
    console.log('데이터베이스 로드 완료');
  } catch (e) {
    console.error("데이터베이스 로드 에러:", e);
  }
}

// 현재 메모리 데이터를 MongoDB에 저장하기
async function saveDatabase() {
  if (!isConnected()) {
    console.log('MongoDB 연결이 준비되지 않아 데이터베이스 저장을 건너뜁니다.');
    return;
  }

  try {
    const savePromises = [];
    
    // 인벤토리 저장
    for (const [userId, items] of inventories) {
      savePromises.push(
        Inventory.findOneAndUpdate(
          { userId },
          { userId: userId, username: users.get(userId)?.username, items },
          { upsert: true }
        ).catch(e => console.error(`인벤토리 저장 에러 (${userId}):`, e))
      );
    }
    
    // 골드 저장
    for (const [userId, amount] of userGold) {
      savePromises.push(
        Gold.findOneAndUpdate(
          { userId },
          { userId, amount },
          { upsert: true }
        ).catch(e => console.error(`골드 저장 에러 (${userId}):`, e))
      );
    }
    
    // 모든 저장 작업 병렬 처리
    await Promise.allSettled(savePromises);
  } catch (e) {
    console.error("데이터베이스 저장 에러:", e);
  }
}

// 사용자별 장비 데이터
const equippedRod = new Map();        // 장착된 낚시대
const equippedAccessory = new Map();  // 장착된 악세사리
const rodEnhancement = new Map();     // 낚시대 강화 수치
const fishingSkills = new Map();      // 낚시 실력 (레벨)
const lastFishingTime = new Map();    // 마지막 낚시 시간

// 자동 장착 함수 (낚시대, 악세사리)
function autoEquip(userId) {
  if (!inventories.has(userId)) return;
  
  const userInventory = inventories.get(userId);
  
  // 낚싯대 자동 장착 (가장 높은 등급 낚싯대)
  let bestRodLevel = 0;
  let bestRod = "맨손"; // 기본값: 맨손
  
  for (const itemName in userInventory) {
    if (userInventory[itemName] > 0) {
      for (const rod in rodData) {
        if (rodData[rod].requires === null && rodData[rod].fishingSkill > bestRodLevel) {
          bestRodLevel = rodData[rod].fishingSkill;
          bestRod = rod;
        }
      }
    }
  }
  
  equippedRod.set(userId, bestRod);
  
  // 악세사리 자동 장착 (가장 높은 등급 악세사리)
  let bestAccessoryLevel = 0;
  let bestAccessory = "없음"; // 기본값: 없음
  
  for (const itemName in userInventory) {
    if (userInventory[itemName] > 0) {
      for (const accessory in accessoryData) {
        if (accessoryData[accessory].requires === null && accessoryData[accessory].fishingSkill > bestAccessoryLevel) {
          bestAccessoryLevel = accessoryData[accessory].fishingSkill;
          bestAccessory = accessory;
        }
      }
    }
  }
  
  equippedAccessory.set(userId, bestAccessory);
}

// 인벤토리 표시 형식 개선
function showInventory(userId, nickname) {
  // 자동 장착 실행
  autoEquip(userId);
  
  const userInventory = inventories.get(userId) || {};
  const gold = userGold.get(userId) || 0;
  const rod = equippedRod.get(userId) || "맨손";
  const accessory = equippedAccessory.get(userId) || "없음";
  const enhancement = rodEnhancement.get(userId) || 0;
  
  let rodDisplay = rod;
  if (enhancement > 0) {
    rodDisplay += ` +${enhancement}`;
  }
  
  // 인벤토리가 비어있는 경우
  if (Object.keys(userInventory).length === 0) {
    return `📦 ${nickname}님의 인벤토리\n` +
           `👜 가방이 비어 있습니다.\n` +
           `💰 보유 골드: ${formatPrice(gold)}원\n` +
           `🎣 장착된 낚시대: ${rodDisplay}\n` +
           `💍 장착된 악세사리: ${accessory}`;
  }
  
  // 물고기와 기타 아이템 분리
  let fishItems = [];
  let materials = [];
  let equipment = [];
  
  for (const itemName in userInventory) {
    // 몽구스 내부 객체 필터링 ($ 또는 _로 시작하는 속성 무시)
    if (itemName.startsWith('$') || itemName.startsWith('_') || userInventory[itemName] <= 0) continue;
    
    // 낚시대 또는 악세사리인지 확인
    let isEquipment = false;
    for (const key in rodData) {
      if (rodData[key].fishingSkill > 0 && key === itemName) {
        isEquipment = true;
        equipment.push({ name: itemName, quantity: userInventory[itemName], type: "rod" });
        break;
      }
    }
    
    if (!isEquipment) {
      for (const key in accessoryData) {
        if (accessoryData[key].fishingSkill > 0 && key === itemName) {
          isEquipment = true;
          equipment.push({ name: itemName, quantity: userInventory[itemName], type: "accessory" });
          break;
        }
      }
    }
    
    if (isEquipment) continue;
    
    // 물고기인지 확인
    let isFish = false;
    for (const fish of fishTypes) {
      if (fish.name === itemName) {
        isFish = true;
        fishItems.push({ name: itemName, quantity: userInventory[itemName], price: fish.price });
        break;
      }
    }
    
    if (!isFish) {
      materials.push({ name: itemName, quantity: userInventory[itemName] });
    }
  }
  
  // 물고기 가격순으로 정렬
  fishItems.sort((a, b) => a.price - b.price);
  
  // 결과 출력
  let result = `📦 ${nickname}님의 인벤토리\n`;
  result += `💰 보유 골드: ${formatPrice(gold)}원\n`;
  result += `🎣 장착된 낚시대: ${rodDisplay}\n`;
  result += `💍 장착된 악세사리: ${accessory}\n\n`;
  
  if (fishItems.length > 0) {
    result += "🐟 물고기:\n";
    for (const fish of fishItems) {
      result += `- ${fish.name} (${fish.quantity}개)\n`;
    }
    result += "\n";
  }
  
  if (equipment.length > 0) {
    result += "⚙️ 장비:\n";
    for (const item of equipment) {
      result += `- ${item.name} (${item.quantity}개)\n`;
    }
    result += "\n";
  }
  
  if (materials.length > 0) {
    result += "🧪 재료:\n";
    for (const material of materials) {
      result += `- ${material.name} (${material.quantity}개)\n`;
    }
  }
  
  return result;
}

function getRandomFish() {
  const rand = Math.random();
  let total = 0;
  for (const fish of fishTypes) {
    total += fish.chance;
    if (rand < total) return fish;
  }
  return fishTypes[0];
}

function getTime() {
  return new Date().toLocaleTimeString();
}

function broadcast(room, messageObj) {
  const json = JSON.stringify(messageObj);
  for (const [client, info] of clients) {
    if (client.readyState === WebSocket.OPEN && info.room === room) {
      client.send(json);
    }
  }
}

// 채팅 로그 저장 함수 수정
async function saveLog(room, content, userId, username) {
  // 로컬 파일 시스템에 저장
  try {
    const logDir = path.join(__dirname, 'chatlogs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
    const filePath = path.join(logDir, `${room}.txt`);
    fs.appendFileSync(filePath, content + '\n');
  } catch (e) {
    console.error("채팅 로그 파일 저장 에러:", e);
  }
  
  // MongoDB에 저장 시도
  if (!isConnected()) {
    console.log('MongoDB 연결이 준비되지 않아 채팅 로그 저장을 건너뜁니다.');
    return;
  }
  
  try {
    const chatLog = new ChatLog({ userId, username, room, content });
    await chatLog.save();
  } catch (e) {
    console.error("채팅 로그 MongoDB 저장 에러:", e);
  }
}

// 채팅 로그 조회 API
app.get('/api/chatlogs/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const logs = await ChatLog.find({ userId }).limit(100);
    res.json({ success: true, logs });
  } catch (e) {
    console.error('채팅 로그 조회 에러:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 모든 채팅방 목록 조회 API
app.get('/api/chatrooms', async (req, res) => {
  try {
    const rooms = await ChatLog.distinct('room');
    res.json({ success: true, rooms });
  } catch (e) {
    console.error('채팅방 목록 조회 에러:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 관리자 골드 수정 API
app.post('/api/admin/gold', async (req, res) => {
  const { username, amount, adminKey } = req.body;
  
  // 관리자 키 확인 (실제 환경에서는 환경변수나 더 안전한 방법으로 관리해야 함)
  const ADMIN_KEY = 'admin_secret_key_12345';
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
app.post('/api/admin/fish', async (req, res) => {
  const { username, fishName, quantity, adminKey } = req.body;
  
  // 관리자 키 확인
  const ADMIN_KEY = 'admin_secret_key_12345';
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
      inventory = new Inventory({ userId: user.uuid, items: {} });
    }
    
    // 메모리에서 인벤토리 처리
    const userInventory = inventories.get(user.uuid) || {};
    userInventory[fishName] = (userInventory[fishName] || 0) + parseInt(quantity);
    inventories.set(user.uuid, userInventory);
    
    // DB에 저장
    const items = inventory.items || {};
    items[fishName] = (items[fishName] || 0) + parseInt(quantity);
    
    await Inventory.findOneAndUpdate(
      { userId: user.uuid },
      { userId: user.uuid, username: user.username, items },
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
app.post('/api/admin/rod', async (req, res) => {
  const { username, rodName, quantity, adminKey } = req.body;
  
  // 관리자 키 확인
  const ADMIN_KEY = 'admin_secret_key_12345';
  if (adminKey !== ADMIN_KEY) {
    return res.status(401).json({ success: false, message: '관리자 권한이 없습니다.' });
  }
  
  if (!username || !rodName || !quantity) {
    return res.status(400).json({ success: false, message: '사용자 이름, 낚시대 이름, 수량을 모두 입력해야 합니다.' });
  }
  
  // 낚시대 확인
  let validRod = false;
  for (const key in rodData) {
    if (rodData[key].fishingSkill > 0 && key === rodName) {
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
      inventory = new Inventory({ userId: user.uuid, items: {} });
    }
    
    // 메모리에서 인벤토리 처리
    const userInventory = inventories.get(user.uuid) || {};
    userInventory[rodName] = (userInventory[rodName] || 0) + parseInt(quantity);
    inventories.set(user.uuid, userInventory);
    
    // DB에 저장
    const items = inventory.items || {};
    items[rodName] = (items[rodName] || 0) + parseInt(quantity);
    
    await Inventory.findOneAndUpdate(
      { userId: user.uuid },
      { userId: user.uuid, username: user.username, items },
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
app.post('/api/admin/accessory', async (req, res) => {
  const { username, accessoryName, quantity, adminKey } = req.body;
  
  // 관리자 키 확인
  const ADMIN_KEY = 'admin_secret_key_12345';
  if (adminKey !== ADMIN_KEY) {
    return res.status(401).json({ success: false, message: '관리자 권한이 없습니다.' });
  }
  
  if (!username || !accessoryName || !quantity) {
    return res.status(400).json({ success: false, message: '사용자 이름, 악세사리 이름, 수량을 모두 입력해야 합니다.' });
  }
  
  // 악세사리 확인
  let validAccessory = false;
  for (const key in accessoryData) {
    if (accessoryData[key].fishingSkill > 0 && key === accessoryName) {
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
      inventory = new Inventory({ userId: user.uuid, items: {} });
    }
    
    // 메모리에서 인벤토리 처리
    const userInventory = inventories.get(user.uuid) || {};
    userInventory[accessoryName] = (userInventory[accessoryName] || 0) + parseInt(quantity);
    inventories.set(user.uuid, userInventory);
    
    // DB에 저장
    const items = inventory.items || {};
    items[accessoryName] = (items[accessoryName] || 0) + parseInt(quantity);
    
    await Inventory.findOneAndUpdate(
      { userId: user.uuid },
      { userId: user.uuid, username: user.username, items },
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

// 웹소켓 메시지 처리를 위한 변수
const pendingDecomposition = new Map(); // { userId: { fishName, quantity } }

// 물고기 판매 처리 함수
function handleSellFish(ws, info, match, time) {
  const { userId, nickname, room } = info;
  const fishName = match[1];
  const quantity = parseInt(match[2]);
  const inv = inventories.get(userId) || {};
  
  // 낚시대나 악세서리는 판매할 수 없음
  let isRod = false;
  let isAccessory = false;
  
  for (const key in rodData) {
    if (rodData[key].fishingSkill > 0 && key === fishName) {
      isRod = true;
      break;
    }
  }
  
  for (const key in accessoryData) {
    if (accessoryData[key].fishingSkill > 0 && key === fishName) {
      isAccessory = true;
      break;
    }
  }
  
  if (isRod || isAccessory) {
    ws.send(JSON.stringify({
      type: 'chat',
      text: `[${time}] ⚠️ 낚시대와 악세서리는 판매할 수 없습니다.`
    }));
    return;
  }
  
  // 해당 물고기가 존재하는지 확인
  const fish = fishTypes.find(f => f.name === fishName);
  if (!fish) {
    ws.send(JSON.stringify({
      type: 'chat',
      text: `[${time}] ⚠️ '${fishName}'은(는) 존재하지 않는 물고기입니다.`
    }));
    return;
  }
  
  // 해당 물고기를 충분히 보유하고 있는지 확인
  const currentCount = inv[fishName] || 0;
  if (currentCount < quantity) {
    ws.send(JSON.stringify({
      type: 'chat',
      text: `[${time}] ⚠️ ${fishName}을(를) ${quantity}개 판매하려면 최소한 ${quantity}개가 필요합니다. 현재 ${currentCount}개 보유 중.`
    }));
    return;
  }
  
  // 판매 금액 계산 (악세사리 보너스 적용)
  const accessory = equippedAccessory.get(userId) || "없음";
  let bonusMultiplier = 1.0;
  
  if (accessory !== "없음") {
    bonusMultiplier = 1.0 + accessoryData[accessory].sellBonus;
  }
  
  const earned = Math.floor(fish.price * quantity * bonusMultiplier);
  
  // 물고기 판매 및 골드 획득
  inv[fishName] -= quantity;
  if (inv[fishName] <= 0) delete inv[fishName];
  
  userGold.set(userId, (userGold.get(userId) || 0) + earned);
  inventories.set(userId, inv);
  
  // 판매 결과 메시지
  const result = `[${time}] 💰 ${nickname}님이 ${fishName} ${quantity}마리를 판매하여 ${formatPrice(earned)}원을 획득했습니다! 현재 골드: ${formatPrice(userGold.get(userId))}원`;
  saveLog(room, result, userId, nickname);
  broadcast(room, { type: 'chat', text: result });
  
  // 데이터베이스 저장
  saveDatabase();
}

// 전체 물고기 판매 처리 함수
function handleSellAll(ws, info, time) {
  const { userId, nickname, room } = info;
  const inv = inventories.get(userId) || {};
  let totalEarned = 0;
  let soldCount = 0;
  const soldFish = [];
  
  // 악세서리 보너스 계산
  const accessory = equippedAccessory.get(userId) || "없음";
  let bonusMultiplier = 1.0;
  
  if (accessory !== "없음") {
    bonusMultiplier = 1.0 + accessoryData[accessory].sellBonus;
  }
  
  // 낚시대와 악세서리를 제외한 물고기만 판매
  for (const itemName in inv) {
    // 낚시대나 악세서리인지 확인
    let isEquipment = false;
    
    // 낚시대 확인
    for (const key in rodData) {
      if (rodData[key].fishingSkill > 0 && key === itemName) {
        isEquipment = true;
        break;
      }
    }
    
    // 악세서리 확인
    if (!isEquipment) {
      for (const key in accessoryData) {
        if (accessoryData[key].fishingSkill > 0 && key === itemName) {
          isEquipment = true;
          break;
        }
      }
    }
    
    // 장비가 아닐 경우 물고기로 간주하고 판매
    if (!isEquipment) {
      const fish = fishTypes.find(f => f.name === itemName);
      if (fish) {
        const count = inv[itemName];
        const earned = Math.floor(fish.price * count * bonusMultiplier);
        totalEarned += earned;
        soldCount += count;
        soldFish.push(`${itemName} (${count}마리)`);
        delete inv[itemName];
      }
    }
  }
  
  // 판매할 물고기가 없는 경우
  if (soldCount === 0) {
    ws.send(JSON.stringify({
      type: 'chat',
      text: `[${time}] ℹ️ 판매할 물고기가 없습니다.`
    }));
    return;
  }
  
  // 골드 지급 및 인벤토리 업데이트
  userGold.set(userId, (userGold.get(userId) || 0) + totalEarned);
  inventories.set(userId, inv);
  
  // 판매 결과 메시지
  const soldFishText = soldFish.join(', ');
  const result = `[${time}] 💰 ${nickname}님이 총 ${soldCount}마리의 물고기(${soldFishText})를 판매하여 ${formatPrice(totalEarned)}원을 획득했습니다! 현재 골드: ${formatPrice(userGold.get(userId))}원`;
  saveLog(room, result, userId, nickname);
  broadcast(room, { type: 'chat', text: result });
  
  // 데이터베이스 저장
  saveDatabase();
}

// 서버 시작 전에 기존 데이터 로드
async function initializeServer() {
  try {
    // MongoDB 데이터 로드 시도 (실패해도 계속 진행)
    try {
      await loadDatabase();
      await loadUsers();
      console.log('MongoDB 데이터 로드 완료');
    } catch (e) {
      console.error('MongoDB 데이터 로드 실패, 서버는 로컬 메모리 데이터로 계속 실행됩니다:', e);
    }
    
    // HTTP 서버 생성
    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server });
    
    wss.on('connection', (ws, request) => {
      const ip = request.headers['x-forwarded-for']?.split(',')[0].trim() || 
                request.socket.remoteAddress;
      
      // 닉네임 요청
      ws.send(JSON.stringify({ type: 'request_nickname' }));
      
      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data);
          const info = clients.get(ws);
          
          // 1. 상점 아이템 정보 요청
          if (parsed.type === 'request' && parsed.requestType === 'shopItems') {
            handleShopItemsRequest(ws);
            return;
          }
          
          // 2. 사용자 정보 요청
          if (parsed.type === 'requestUserInfo') {
            const targetUserId = parsed.targetUserId;
            handleUserInfoRequest(ws, targetUserId);
            return;
          }
          
          // 3. 채팅방 입장
          if (parsed.type === 'join') {
            const nickname = parsed.nickname;
            const room = parsed.room;
            const uuid = parsed.uuid;
            handleJoin(ws, nickname, room, uuid, ip);
            return;
          }
          
          // 4. 아이템 구매
          if (parsed.type === 'buy') {
            if (!info) return;
            handleBuyItem(ws, info, parsed);
            return;
          }
          
          // 5. 일반 메시지
          if (parsed.type === 'message') {
            if (!info) return;
            const { userId, nickname, room } = info;
            const { text } = parsed;
            const time = getTime();
            
            const formatted = `[${time}] ${nickname}: ${text}`;
            saveLog(room, formatted, userId, nickname);
            broadcast(room, { type: 'chat', text: formatted });
            return;
          }
          
        } catch (e) {
          console.error('메시지 처리 오류:', e);
        }
      });
      
      // 이하 helper 함수들
      function handleShopItemsRequest(ws) {
        const rodItems = [];
        for (const [rodName, rodInfo] of Object.entries(rodData)) {
          if (rodName === "맨손") continue;
          
          rodItems.push({
            name: rodName,
            price: rodInfo.price,
            fishingSkill: rodInfo.fishingSkill,
            requires: rodInfo.requires
          });
        }
        
        const accessoryItems = [];
        for (const [accName, accInfo] of Object.entries(accessoryData)) {
          if (accName === "없음") continue;
          
          accessoryItems.push({
            name: accName,
            price: accInfo.price,
            cooldownReduction: accInfo.cooldownReduction,
            sellBonus: accInfo.sellBonus,
            requires: accInfo.requires
          });
        }
        
        ws.send(JSON.stringify({
          type: 'shopItems',
          rods: rodItems,
          accessories: accessoryItems
        }));
      }
      
      function handleUserInfoRequest(ws, targetUserId) {
        const info = {
          type: 'userInfo',
          userId: targetUserId,
          inventory: inventories.get(targetUserId) || {},
          gold: userGold.get(targetUserId) || 0,
          fishingSkill: fishingSkills.get(targetUserId) || 0
        };
        ws.send(JSON.stringify(info));
      }
      
      function handleJoin(ws, nickname, room, uuid, ip) {
        const userId = uuid || ip;
        
        // 동일 ID와 동일 닉네임으로 이미 접속 중인 기존 연결이 있으면 종료
        for (const [client, info] of clients.entries()) {
          if (info.userId === userId && info.nickname === nickname && client !== ws) {
            client.send(JSON.stringify({ text: `⚠️ 다른 위치에서 ${nickname}으로 접속되어 연결이 종료됩니다.` }));
            clients.delete(client);
            client.terminate();
          }
        }

        // 새 연결 등록
        clients.set(ws, { userId, nickname, room });
        if (!inventories.has(userId)) {
          inventories.set(userId, {});
          saveDatabase();
        }
        if (!userGold.has(userId)) {
          userGold.set(userId, 0);
          saveDatabase();
        }

        // 참여자 목록 생성 및 전송
        const allUsers = [];
        for (const [, info] of clients) {
          if (info.room === room) {
            allUsers.push({ userId: info.userId, nickname: info.nickname });
          }
        }
        
        ws.send(JSON.stringify({ 
          type: 'full_user_list', 
          users: allUsers 
        }));

        // join 메시지 전송
        const joinMsg = {
          type: 'join',
          text: `[${getTime()}] 💬 ${nickname}님이 입장했습니다.`,
          userId,
          nickname
        };
        broadcast(room, joinMsg);
        
        // 최신 목록 전송
        broadcast(room, { 
          type: 'full_user_list', 
          users: allUsers 
        });
      }
      
      function handleBuyItem(ws, info, parsed) {
        const { userId, nickname, room } = info;
        const { item, price } = parsed;
        const time = getTime();
        
        // 골드 확인
        let gold = userGold.get(userId) || 0;
        
        if (gold < price) {
          ws.send(JSON.stringify({
            type: 'chat',
            text: `[${time}] ⚠️ 골드가 부족합니다. 필요: ${formatPrice(price)}골드, 보유: ${formatPrice(gold)}골드`
          }));
          return;
        }
        
        // 아이템 구매 처리
        if (item.startsWith('구매 ')) {
          const itemName = item.substring(3);
          
          // 아이템 확인
          let isRod = false;
          let rodLevel = -1;
          
          // 낚시대 확인
          for (const [level, rodName] of Object.entries(rodData)) {
            if (rodName === itemName) {
              isRod = true;
              rodLevel = parseInt(level);
              break;
            }
          }
          
          // 악세사리 확인
          let isAccessory = false;
          if (!isRod) {
            for (const [level, accName] of Object.entries(accessoryData)) {
              if (accName === itemName) {
                isAccessory = true;
                break;
              }
            }
          }
          
          if (!isRod && !isAccessory) {
            ws.send(JSON.stringify({
              type: 'chat',
              text: `[${time}] ❌ ${itemName}은(는) 구매할 수 없는 아이템입니다.`
            }));
            return;
          }
          
          // 가격 계산
          let itemPrice = 0;
          if (isRod) {
            itemPrice = rodData[itemName].price;
          } else {
            itemPrice = accessoryData[itemName].price;
          }
          
          // 골드 확인
          if (gold < itemPrice) {
            ws.send(JSON.stringify({
              type: 'chat',
              text: `[${time}] ❌ 골드가 부족합니다. 필요한 골드: ${formatPrice(itemPrice)}원, 현재 골드: ${formatPrice(gold)}원`
            }));
            return;
          }
          
          // 구매 처리
          userGold.set(userId, gold - itemPrice);
          
          // 인벤토리에 추가
          const inv = inventories.get(userId) || {};
          inv[itemName] = (inv[itemName] || 0) + 1;
          inventories.set(userId, inv);
          
          // 낚시대를 구매한 경우 낚시 스킬을 증가시킴
          if (isRod) {
            fishingSkills.set(userId, rodLevel);
            
            // 스킬업 메시지
            const skillUpMsg = `[${time}] 🎯 ${nickname}님의 낚시 스킬이 레벨 ${rodLevel}로 상승했습니다!`;
            saveLog(room, skillUpMsg, userId, nickname);
            broadcast(room, { type: 'chat', text: skillUpMsg });
          }
          
          // 구매 성공 메시지
          const result = `[${time}] 🎣 ${nickname}님이 ${itemName}을(를) 구매했습니다! (남은 골드: ${formatPrice(gold - itemPrice)}원)`;
          saveLog(room, result, userId, nickname);
          ws.send(JSON.stringify({ type: 'chat', text: result }));
          
          // 데이터베이스 저장
          saveDatabase();
        }
      }
      
      ws.on('close', () => {
        const info = clients.get(ws);
        if (info) {
          const { nickname, room } = info;
          clients.delete(ws);
          const exitMsg = {
            type: 'leave',
            text: `[${getTime()}] 👋 ${nickname}님이 퇴장했습니다.`,
            nickname: nickname
          };
          broadcast(room, exitMsg);
          
          // 모든 참여자에게 최신 참여자 목록 전송하기
          const allUsers = [];
          for (const [, info] of clients) {
            if (info.room === room) {
              allUsers.push({ userId: info.userId, nickname: info.nickname });
            }
          }
          broadcast(room, { 
            type: 'full_user_list', 
            users: allUsers 
          });
        }
      });

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    });
    
    // 라우터 설정
    app.use('/api/user', userRouter);
    app.use('/api/admin', adminRouter);
    app.use('/api/fishing', fishingRouter);
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    });
  } catch (e) {
    console.error('서버 초기화 에러:', e);
    process.exit(1);
  }
}

initializeServer();
