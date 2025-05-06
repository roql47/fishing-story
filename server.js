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
    // 낚시 스킬 레벨 초기화 (추가)
    const fishingSkill = new FishingSkill({ userId: uuid, level: 1 });
    
    await inventory.save();
    await gold.save();
    await fishingSkill.save(); // 낚시 스킬 레벨 저장 (추가)
    
    // 메모리에도 추가
    users.set(username, { password, uuid });
    inventories.set(uuid, {});
    userGold.set(uuid, 0);
    fishingSkills.set(uuid, 1); // 메모리에 낚시 스킬 레벨 설정 (추가)
    
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
    const inventoriesData = await Inventory.find({});
    const goldData = await Gold.find({});
    const fishingSkillData = await FishingSkill.find({});
    
    for (const inv of inventoriesData) {
      inventories.set(inv.userId, inv.items);
    }
    
    for (const gold of goldData) {
      userGold.set(gold.userId, gold.amount);
    }
    
    for (const skill of fishingSkillData) {
      fishingSkills.set(skill.userId, skill.level);
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
          { userId, items },
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

// 낚시대 및 악세사리 정보
const rodNames = {
  0: "맨손",
  1: "낡은낚시대",
  2: "일반낚시대",
  3: "단단한낚시대",
  4: "은낚시대",
  5: "금낚시대",
  6: "강철낚시대",
  7: "사파이어낚시대",
  8: "루비낚시대",
  9: "다이아몬드낚시대",
  10: "레드다이아몬드낚시대",
  11: "벚꽃낚시대",
  12: "꽃망울낚시대",
  13: "호롱불낚시대",
  14: "산호등낚시대",
  15: "피크닉",
  16: "마녀빗자루",
  17: "에테르낚시대",
  18: "별조각낚시대",
  19: "여우꼬리낚시대",
  20: "초콜릿롤낚시대",
  21: "호박유령낚시대",
  22: "핑크버니낚시대",
  23: "할로우낚시대",
  24: "여우불낚시대"
};

const accessoryNames = {
  0: "없음",
  1: "오래된반지",
  2: "은목걸이",
  3: "금귀걸이",
  4: "마법의펜던트",
  5: "에메랄드브로치",
  6: "토파즈이어링",
  7: "자수정팔찌",
  8: "백금티아라",
  9: "만드라고라허브",
  10: "에테르나무묘목",
  11: "몽마의조각상",
  12: "마카롱훈장",
  13: "빛나는마력순환체"
};

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
  let bestRod = rodNames[0]; // 기본값: 맨손
  
  for (const itemName in userInventory) {
    if (userInventory[itemName] > 0) {
      for (const rodLevel in rodNames) {
        if (rodNames[rodLevel] === itemName && parseInt(rodLevel) > bestRodLevel) {
          bestRodLevel = parseInt(rodLevel);
          bestRod = itemName;
        }
      }
    }
  }
  
  equippedRod.set(userId, bestRod);
  
  // 악세사리 자동 장착 (가장 높은 등급 악세사리)
  let bestAccessoryLevel = 0;
  let bestAccessory = accessoryNames[0]; // 기본값: 없음
  
  for (const itemName in userInventory) {
    if (userInventory[itemName] > 0) {
      for (const accessoryLevel in accessoryNames) {
        if (accessoryNames[accessoryLevel] === itemName && parseInt(accessoryLevel) > bestAccessoryLevel) {
          bestAccessoryLevel = parseInt(accessoryLevel);
          bestAccessory = itemName;
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
  const rod = equippedRod.get(userId) || rodNames[0];
  const accessory = equippedAccessory.get(userId) || accessoryNames[0];
  const enhancement = rodEnhancement.get(userId) || 0;
  const fishingSkill = fishingSkills.get(userId) || 0;
  
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
           `💍 장착된 악세사리: ${accessory}\n` +
           `🔰 낚시 스킬: ${fishingSkill}`;
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
    for (const key in rodNames) {
      if (rodNames[key] === itemName) {
        isEquipment = true;
        equipment.push({ name: itemName, quantity: userInventory[itemName], type: "rod" });
        break;
      }
    }
    
    if (!isEquipment) {
      for (const key in accessoryNames) {
        if (accessoryNames[key] === itemName) {
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
  result += `💍 장착된 악세사리: ${accessory}\n`;
  result += `🔰 낚시 스킬: ${fishingSkill}\n\n`;
  
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

function getTime() {
  return new Date().toLocaleTimeString();
}

// 랜덤 물고기 획득 함수 (catchProbabilities 사용)
function getRandomFish() {
  // 희귀 물고기 (스타피쉬) 확률 체크
  if (Math.random() < 0.005) {
    return fishTypes[fishTypes.length - 1]; // 스타피쉬
  }
  
  const rand = Math.random() * 100;
  let cumulativeProbability = 0;
  
  for (let i = 0; i < Math.min(catchProbabilities.length, fishTypes.length); i++) {
    cumulativeProbability += catchProbabilities[i];
    if (rand < cumulativeProbability) {
      return fishTypes[i];
    }
  }
  
  // 기본값 설정 (확률이 맞지 않는 경우를 대비)
  return fishTypes[0];
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
async function saveLog(room, content, username = null, userId = null) {
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
    const chatLog = new ChatLog({ room, content, username, userId });
    await chatLog.save();
  } catch (e) {
    console.error("채팅 로그 MongoDB 저장 에러:", e);
  }
}

// 채팅 로그 조회 API
app.get('/api/chatlogs/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const logs = await ChatLog.find({ room }).sort({ timestamp: -1 }).limit(100);
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

// 물고기 데이터 API - 클라이언트에서 물고기 정보를 가져갈 수 있도록 함
app.get('/api/fish-data', (req, res) => {
  try {
    res.json({
      success: true,
      fishTypes: fishTypes,
      catchProbabilities: catchProbabilities
    });
  } catch (e) {
    console.error('물고기 데이터 API 에러:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 웹소켓 메시지 처리를 위한 변수
const pendingDecomposition = new Map(); // { userId: { fishName, quantity } }

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
      // 연결 시 클라이언트의 IP 주소를 임시 userId로 사용 (실제 로그인 후 UUID로 대체됨)
      const ip = request.socket.remoteAddress;
      // 클라이언트에게 join 요청 메시지 전송
      ws.send(JSON.stringify({ type: 'request_nickname' }));

      ws.on('message', (data) => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }

        // 사용자 정보 요청 (닉네임 클릭 시)
        if (parsed.type === 'requestUserInfo') {
          const targetUserId = parsed.targetUserId;
          
          // MongoDB에서 최신 데이터 가져오기
          (async () => {
            try {
              console.log(`사용자 정보 요청: ${targetUserId}`);
              
              // 인벤토리 가져오기
              let inventoryDoc = await Inventory.findOne({ userId: targetUserId });
              let items = {};
              
              if (inventoryDoc) {
                if (inventoryDoc.items instanceof Map) {
                  // Map인 경우
                  for (const [key, value] of inventoryDoc.items.entries()) {
                    items[key] = value;
                  }
                } else if (inventoryDoc.items && typeof inventoryDoc.items === 'object') {
                  // 객체인 경우
                  items = {...inventoryDoc.items};
                }
              }
              
              // 골드 가져오기
              const goldDoc = await Gold.findOne({ userId: targetUserId });
              const gold = goldDoc ? goldDoc.amount : 0;
              
              // 메모리 데이터 업데이트
              inventories.set(targetUserId, items);
              userGold.set(targetUserId, gold);
              
              console.log('사용자 인벤토리:', items);
              
              // 응답 보내기
              const info = {
                type: 'userInfo',
                userId: targetUserId,
                inventory: items,
                gold: gold,
                skillLevel: fishingSkills.get(targetUserId) || 1
              };
              ws.send(JSON.stringify(info));
              
            } catch (e) {
              console.error('사용자 정보 요청 처리 중 오류:', e);
              ws.send(JSON.stringify({
                type: 'chat',
                text: `[${getTime()}] ⚠️ 사용자 정보를 가져오는 중 오류가 발생했습니다.`
              }));
            }
          })();
          
          return;
        }

        // join 메시지 처리
        if (parsed.type === 'join') {
          const nickname = parsed.nickname;
          const room = parsed.room;
          const uuid = parsed.uuid; // 로그인 후 받은 UUID
          const userId = uuid || ip; // UUID가 없으면 IP 사용 (비로그인 사용자)
          
          // 동일 ID와 동일 닉네임으로 이미 접속 중인 기존 연결이 있으면 종료
          for (const [client, info] of clients.entries()) {
            if (info.userId === userId && info.nickname === nickname && client !== ws) {
              client.send(JSON.stringify({ text: `⚠️ 다른 위치에서 ${nickname}으로 접속되어 연결이 종료됩니다.` }));
              clients.delete(client);
              client.terminate();
            }
          }

          // 새 연결 등록 (기존 데이터는 유지)
          clients.set(ws, { userId, nickname, room });
          
          // MongoDB에서 인벤토리와 골드 데이터 확인 후 메모리에 로드
          (async () => {
            try {
              console.log(`사용자 입장: ${userId}`);
              
              // 인벤토리 확인 및 생성
              const inventoryDoc = await Inventory.findOne({ userId });
              let items = {};
              
              if (inventoryDoc && inventoryDoc.items) {
                if (inventoryDoc.items instanceof Map) {
                  // Map인 경우
                  for (const [key, value] of inventoryDoc.items.entries()) {
                    items[key] = value;
                  }
                } else if (typeof inventoryDoc.items === 'object') {
                  // 객체인 경우
                  items = {...inventoryDoc.items};
                }
              } else {
                // 새 인벤토리 생성
                await Inventory.updateOne(
                  { userId },
                  { userId, items: {} },
                  { upsert: true }
                );
              }
              
              // 메모리에 인벤토리 설정
              inventories.set(userId, items);
              console.log('로드된 인벤토리:', items);
              
              // 골드 확인 및 생성
              const goldDoc = await Gold.findOne({ userId });
              const gold = goldDoc ? goldDoc.amount : 0;
              
              if (!goldDoc) {
                // 새 골드 데이터 생성
                await Gold.updateOne(
                  { userId },
                  { userId, amount: 0 },
                  { upsert: true }
                );
              }
              
              // 메모리에 골드 설정
              userGold.set(userId, gold);
              console.log('로드된 골드:', gold);
              
              // 모든 참여자 목록 생성
              const allUsers = [];
              for (const [, info] of clients) {
                if (info.room === room) {
                  allUsers.push({ userId: info.userId, nickname: info.nickname });
                }
              }
              
              // 새 사용자에게 전체 사용자 목록 전송
              ws.send(JSON.stringify({ 
                type: 'full_user_list', 
                users: allUsers 
              }));

              // join 메시지에 userId 포함하여 브로드캐스트
              const joinMsg = {
                type: 'join',
                text: `[${getTime()}] 💬 ${nickname}님이 입장했습니다.`,
                userId,
                nickname
              };
              broadcast(room, joinMsg);
              
              // 입장 메시지 저장
              await saveLog(room, joinMsg.text, nickname, userId);
              
              // 모든 참여자에게 최신 참여자 목록 전송하기
              broadcast(room, { 
                type: 'full_user_list', 
                users: allUsers 
              });
            } catch (e) {
              console.error('사용자 입장 처리 중 오류:', e);
              ws.send(JSON.stringify({
                type: 'chat',
                text: `[${getTime()}] ⚠️ 데이터 로드 중 오류가 발생했습니다. 다시 접속해주세요.`
              }));
            }
          })();
          
          return;
        }

        if (parsed.type === 'buy') {
          const info = clients.get(ws);
          if (!info) return;
          const { userId, nickname, room } = info;
          const { item, price } = parsed;
          const time = getTime();
          
          // 사용자의 골드 확인
          let gold = userGold.get(userId) || 0;
          
          if (gold < price) {
            // 골드가 부족한 경우
            ws.send(JSON.stringify({
              type: 'chat',
              text: `[${time}] ⚠️ 골드가 부족합니다. 필요: ${formatPrice(price)}골드, 보유: ${formatPrice(gold)}골드`
            }));
            return;
          }
          
          // 구매 처리 (낚시대 및 악세사리도 처리)
          let purchaseSuccessful = false;
          const inv = inventories.get(userId) || {};
          
          // 낚시대 목록에 있는지 확인
          for (const key in rodNames) {
            if (rodNames[key] === item) {
              // 순차적 구매 체크 (이전 등급의 낚시대 필요)
              const newRodLevel = parseInt(key);
              
              // 이미 같은 등급의 낚시대를 소유하고 있는지 확인
              if (inv[item] && inv[item] > 0) {
                ws.send(JSON.stringify({
                  type: 'chat',
                  text: `[${time}] ⚠️ 이미 ${item}을(를) 소유하고 있습니다.`
                }));
                return;
              }
              
              // 이전 단계 낚시대를 보유하고 있는지 확인
              if (newRodLevel > 1) {
                const prevRodName = rodNames[newRodLevel - 1];
                if (!inv[prevRodName] || inv[prevRodName] <= 0) {
                  ws.send(JSON.stringify({
                    type: 'chat',
                    text: `[${time}] ⚠️ ${item}을(를) 구매하려면 먼저 이전 단계 낚시대(${prevRodName})를 구매해야 합니다.`
                  }));
                  return;
                }
              }
              
              // 골드 차감
              userGold.set(userId, gold - price);
              
              // 인벤토리에 낚시대 추가
              inv[item] = 1;
              inventories.set(userId, inv);
              
              // 낚시 스킬 증가
              const currentSkill = fishingSkills.get(userId) || 0;
              fishingSkills.set(userId, currentSkill + 1);
              
              // MongoDB에 낚시 스킬 레벨 직접 저장 (새 코드)
              (async () => {
                try {
                  const { FishingSkill } = require('./models/database');
                  await FishingSkill.findOneAndUpdate(
                    { userId },
                    { userId, level: currentSkill + 1 },
                    { upsert: true, new: true }
                  );
                  console.log(`낚시 스킬 레벨 MongoDB 직접 업데이트 완료 (${userId}): ${currentSkill + 1}`);
                } catch (e) {
                  console.error('낚시 스킬 레벨 직접 저장 오류:', e);
                }
              })();
              
              // 자동 장착
              autoEquip(userId);
              
              purchaseSuccessful = true;
              
              // 구매 성공 메시지
              const result = `[${time}] 🎣 ${nickname}님이 ${item}을(를) 구매했습니다! 낚시 스킬이 ${currentSkill + 1} 레벨이 되었습니다! (남은 골드: ${formatPrice(gold - price)}원)`;
              saveLog(room, result, nickname, userId);
              ws.send(JSON.stringify({ type: 'chat', text: result }));
              
              // 전체 방에 알림
              broadcast(room, {
                type: 'chat',
                text: `[${time}] 💰 ${nickname}님이 ${item}을(를) 구매했습니다!`
              });
              
              break;
            }
          }
          
          // 악세사리 목록에 있는지 확인 (낚시대가 아닌 경우)
          if (!purchaseSuccessful) {
            for (const key in accessoryNames) {
              if (accessoryNames[key] === item) {
                // 순차적 구매 체크 (이전 등급의 악세사리 필요)
                const newAccessoryLevel = parseInt(key);
                
                // 이미 같은 등급의 악세사리를 소유하고 있는지 확인
                if (inv[item] && inv[item] > 0) {
                  ws.send(JSON.stringify({
                    type: 'chat',
                    text: `[${time}] ⚠️ 이미 ${item}을(를) 소유하고 있습니다.`
                  }));
                  return;
                }
                
                // 이전 단계 악세사리를 보유하고 있는지 확인
                if (newAccessoryLevel > 1) {
                  const prevAccessoryName = accessoryNames[newAccessoryLevel - 1];
                  if (!inv[prevAccessoryName] || inv[prevAccessoryName] <= 0) {
                    ws.send(JSON.stringify({
                      type: 'chat',
                      text: `[${time}] ⚠️ ${item}을(를) 구매하려면 먼저 이전 단계 악세사리(${prevAccessoryName})를 구매해야 합니다.`
                    }));
                    return;
                  }
                }
                
                // 골드 차감
                userGold.set(userId, gold - price);
                
                // 인벤토리에 악세사리 추가
                inv[item] = 1;
                inventories.set(userId, inv);
                
                // 자동 장착
                autoEquip(userId);
                
                purchaseSuccessful = true;
                
                // 구매 성공 메시지
                const result = `[${time}] 💍 ${nickname}님이 ${item}을(를) 구매했습니다! (남은 골드: ${formatPrice(gold - price)}원)`;
                saveLog(room, result, nickname, userId);
                ws.send(JSON.stringify({ type: 'chat', text: result }));
                
                // 전체 방에 알림
                broadcast(room, {
                  type: 'chat',
                  text: `[${time}] 💰 ${nickname}님이 ${item}을(를) 구매했습니다!`
                });
                
                break;
              }
            }
          }
          
          // 낚시대도 악세사리도 아닌 경우 (존재하지 않는 아이템)
          if (!purchaseSuccessful) {
            ws.send(JSON.stringify({
              type: 'chat',
              text: `[${time}] ⚠️ '${item}'은(는) 상점에 없는 아이템입니다.`
            }));
          } else {
            // 성공한 경우 데이터베이스 저장
            saveDatabase();
          }
          
          return;
        }

        if (parsed.type === 'message') {
          const info = clients.get(ws);
          if (!info) return;
          const { userId, nickname, room } = info;
          const text = parsed.text.trim();
          const time = getTime();

          // 🎣 낚시하기
          if (text === '낚시하기') {
            const currentTime = Date.now();
            
            // 낚시 쿨다운 계산 (악세사리에 따른 쿨다운 감소)
            let cooldownTime = 300000; // 기본 5분
            const accessory = equippedAccessory.get(userId) || accessoryNames[0];
            
            switch(accessory) {
              case "오래된반지": cooldownTime = 285000; break;
              case "은목걸이": cooldownTime = 270000; break;
              case "금귀걸이": cooldownTime = 255000; break;
              case "마법의펜던트": cooldownTime = 240000; break;
              case "에메랄드브로치": cooldownTime = 225000; break;
              case "토파즈이어링": cooldownTime = 210000; break;
              case "자수정팔찌": cooldownTime = 195000; break;
              case "백금티아라": cooldownTime = 180000; break;
              case "만드라고라허브": cooldownTime = 165000; break;
              case "에테르나무묘목": cooldownTime = 150000; break;
              case "몽마의조각상": cooldownTime = 135000; break;
              case "마카롱훈장": cooldownTime = 120000; break;
              case "빛나는마력순환체": cooldownTime = 105000; break;
              default: cooldownTime = 300000; break;
            }
            
            if (lastFishingTime.has(userId) && (currentTime - lastFishingTime.get(userId)) < cooldownTime) {
              const remainingTime = Math.ceil((cooldownTime - (currentTime - lastFishingTime.get(userId))) / 1000);
              ws.send(JSON.stringify({
                type: 'chat',
                text: `[${time}] ⏳ ${remainingTime}초 후에 다시 낚시할 수 있습니다.`
              }));
              return;
            }
            
            // 낚시 스킬 레벨에 따른 물고기 범위 조정
            const skillLevel = fishingSkills.get(userId) || 1;
            let fishStartIndex = 0, fishEndIndex = 10;
            
            if (skillLevel === 2) { fishStartIndex = 1; }
            else if (skillLevel === 3) { fishStartIndex = 2; fishEndIndex = 11; }
            else if (skillLevel === 4) { fishStartIndex = 3; fishEndIndex = 12; }
            else if (skillLevel === 5) { fishStartIndex = 4; fishEndIndex = 13; }
            else if (skillLevel === 6) { fishStartIndex = 5; fishEndIndex = 14; }
            else if (skillLevel === 7) { fishStartIndex = 6; fishEndIndex = 15; }
            else if (skillLevel === 8) { fishStartIndex = 7; fishEndIndex = 16; }
            else if (skillLevel === 9) { fishStartIndex = 8; fishEndIndex = 17; }
            else if (skillLevel === 10) { fishStartIndex = 9; fishEndIndex = 18; }
            else if (skillLevel === 11) { fishStartIndex = 10; fishEndIndex = 19; }
            else if (skillLevel === 12) { fishStartIndex = 11; fishEndIndex = 20; }
            else if (skillLevel === 13) { fishStartIndex = 12; fishEndIndex = 21; }
            else if (skillLevel === 14) { fishStartIndex = 13; fishEndIndex = 22; }
            else if (skillLevel === 15) { fishStartIndex = 14; fishEndIndex = 23; }
            else if (skillLevel === 16) { fishStartIndex = 15; fishEndIndex = 24; }
            else if (skillLevel === 17) { fishStartIndex = 16; fishEndIndex = 25; }
            else if (skillLevel === 18) { fishStartIndex = 17; fishEndIndex = 26; }
            else if (skillLevel === 19) { fishStartIndex = 18; fishEndIndex = 27; }
            else if (skillLevel === 20) { fishStartIndex = 19; fishEndIndex = 28; }
            else if (skillLevel === 21) { fishStartIndex = 20; fishEndIndex = 29; }
            else if (skillLevel === 22) { fishStartIndex = 21; fishEndIndex = 30; }
            else if (skillLevel === 23) { fishStartIndex = 22; fishEndIndex = 31; }
            else if (skillLevel === 24) { fishStartIndex = 23; fishEndIndex = 32; }
            else if (skillLevel === 25) { fishStartIndex = 24; fishEndIndex = 33; }
            else if (skillLevel === 26) { fishStartIndex = 25; fishEndIndex = 34; }
            else if (skillLevel === 27) { fishStartIndex = 26; fishEndIndex = 35; }
            else if (skillLevel === 28) { fishStartIndex = 27; fishEndIndex = 36; }
            else if (skillLevel === 29) { fishStartIndex = 28; fishEndIndex = 37; }
            else if (skillLevel === 30) { fishStartIndex = 29; fishEndIndex = 38; }
            else if (skillLevel >= 31) { fishStartIndex = 30; fishEndIndex = 39; }
            
            const effectiveFishTypes = fishTypes.slice(fishStartIndex, fishEndIndex);
            
            // 최종 물고기 선택
            let randomValue = Math.random() * 100;
            let cumulativeProbability = 0;
            let selectedFish;
            
            // 희귀 물고기 (스타피쉬) 확률 체크
            if (Math.random() < 0.005) {
              selectedFish = fishTypes[fishTypes.length - 1]; // 스타피쉬
            } else {
              for (let i = 0; i < Math.min(catchProbabilities.length, effectiveFishTypes.length); i++) {
                cumulativeProbability += catchProbabilities[i];
                if (randomValue < cumulativeProbability) {
                  selectedFish = effectiveFishTypes[i];
                  break;
                }
              }
              
              // 기본값 설정 (확률이 맞지 않는 경우를 대비)
              if (!selectedFish) {
                selectedFish = effectiveFishTypes[0];
              }
            }
            
            // 인벤토리 및 낚시 횟수 업데이트
            const inv = inventories.get(userId) || {};
            inv[selectedFish.name] = (inv[selectedFish.name] || 0) + 1;
            inventories.set(userId, inv);
            
            // 마지막 낚시 시간 업데이트
            lastFishingTime.set(userId, currentTime);
            
            // MongoDB에 저장 (Map 타입 올바르게 처리)
            (async () => {
              try {
                console.log(`낚시 시도: ${userId}가 ${selectedFish.name} 획득`);
                
                // 완전히 단순화된 접근 방식: 기존 데이터를 유지하면서 새 항목만 업데이트
                const updateResult = await Inventory.updateOne(
                  { userId },
                  { $inc: { [`items.${selectedFish.name}`]: 1 } },
                  { upsert: true }
                );
                
                console.log('낚시 인벤토리 업데이트 결과:', updateResult);
                
                // 결과 메시지
                const result = `[${time}] 🎣 ${nickname}님이 '${selectedFish.name}'(을)를 낚았습니다!`;
                saveLog(room, result, nickname, userId);
                broadcast(room, { type: 'chat', text: result });
              } catch (e) {
                console.error('낚시 MongoDB 업데이트 에러:', e);
                
                // 강제로 새 방식 시도 - 첫 낚시일 경우를 위해
                try {
                  console.log('대체 저장 방식 시도...');
                  // 새 문서 생성 또는 기존 문서 전체 교체
                  const inv = inventories.get(userId) || {};
                  await Inventory.findOneAndUpdate(
                    { userId },
                    { 
                      userId, 
                      items: { [selectedFish.name]: 1 } 
                    },
                    { upsert: true, new: true }
                  );
                  console.log('대체 저장 성공!');
                  
                  // 결과 메시지
                  const result = `[${time}] 🎣 ${nickname}님이 '${selectedFish.name}'(을)를 낚았습니다!`;
                  saveLog(room, result, nickname, userId);
                  broadcast(room, { type: 'chat', text: result });
                } catch (e2) {
                  console.error('대체 저장 방식도 실패:', e2);
                  ws.send(JSON.stringify({
                    type: 'chat',
                    text: `[${time}] ⚠️ 오류가 발생했습니다. 관리자에게 문의하세요. (오류: ${e.message})`
                  }));
                }
              }
            })();
            
            return;
          }

          // 💰 판매
          if (text === '판매') {
            (async () => {
              try {
                console.log(`판매 시도: ${userId}`);
                
                // 인벤토리 가져오기
                let inventoryDoc = await Inventory.findOne({ userId });
                let items = {};
                
                if (!inventoryDoc) {
                  inventoryDoc = new Inventory({ 
                    userId,
                    items: {}
                  });
                } else {
                  if (inventoryDoc.items instanceof Map) {
                    // Map인 경우
                    for (const [key, value] of inventoryDoc.items.entries()) {
                      items[key] = value;
                    }
                  } else if (inventoryDoc.items && typeof inventoryDoc.items === 'object') {
                    // 객체인 경우
                    items = {...inventoryDoc.items};
                  }
                }
                
                let earned = 0;
                
                // 모든 물고기 순회하며 판매 처리
                for (const fish of fishTypes) {
                  const count = items[fish.name] || 0;
                  // 스타피쉬는 판매하지 않음
                  if (fish.name === '스타피쉬' || count <= 0) continue;
                  earned += count * fish.price;
                  delete items[fish.name];
                }
                
                // 판매 금액 계산 (악세사리 보너스 적용)
                const accessory = equippedAccessory.get(userId) || accessoryNames[0];
                let bonusMultiplier = 1.0;
                
                switch(accessory) {
                  case "오래된반지": bonusMultiplier = 1.08; break;
                  case "은목걸이": bonusMultiplier = 1.16; break;
                  case "금귀걸이": bonusMultiplier = 1.24; break;
                  case "마법의펜던트": bonusMultiplier = 1.32; break;
                  case "에메랄드브로치": bonusMultiplier = 1.40; break;
                  case "토파즈이어링": bonusMultiplier = 1.48; break;
                  case "자수정팔찌": bonusMultiplier = 1.56; break;
                  case "백금티아라": bonusMultiplier = 1.64; break;
                  case "만드라고라허브": bonusMultiplier = 1.72; break;
                  case "에테르나무묘목": bonusMultiplier = 1.84; break;
                  case "몽마의조각상": bonusMultiplier = 1.92; break;
                  case "마카롱훈장": bonusMultiplier = 2.0; break;
                  case "빛나는마력순환체": bonusMultiplier = 2.08; break;
                  default: bonusMultiplier = 1.0; break;
                }
                
                const finalEarned = Math.floor(earned * bonusMultiplier);
                
                // 골드 가져오기 및 업데이트
                let goldDoc = await Gold.findOne({ userId });
                if (!goldDoc) {
                  goldDoc = new Gold({ userId, amount: 0 });
                }
                
                const newGoldAmount = goldDoc.amount + finalEarned;
                goldDoc.amount = newGoldAmount;
                await goldDoc.save();
                
                // 인벤토리 저장
                inventoryDoc.items = items;
                await inventoryDoc.save();
                
                // 메모리 데이터 업데이트
                inventories.set(userId, items);
                userGold.set(userId, newGoldAmount);
                
                console.log('판매 후 인벤토리:', items);
                console.log('판매 후 골드:', newGoldAmount);
                
                // 판매 결과 메시지 (판매한 물고기 상세 정보 포함)
                let result = `[${time}] 💰 ${nickname}님이 물고기를 판매했습니다!\n`;
                
                if (bonusMultiplier > 1.0) {
                  result += `\n악세사리(${accessory}) 판매 보너스 ${Math.floor((bonusMultiplier - 1) * 100)}% 적용!`;
                }
                
                result += `\n\n총 획득 골드: ${formatPrice(finalEarned)}원\n현재 골드: ${formatPrice(newGoldAmount)}원`;
                
                saveLog(room, result, nickname, userId);
                ws.send(JSON.stringify({ type: 'chat', text: result }));
                
                // 간소화된 알림을 다른 사용자에게 전송
                const publicMsg = `[${time}] 💰 ${nickname}님이 물고기를 판매하여 ${formatPrice(finalEarned)}원을 획득했습니다!`;
                for (const [client, info] of clients) {
                  if (client !== ws && info.room === room) {
                    client.send(JSON.stringify({ type: 'chat', text: publicMsg }));
                  }
                }
              } catch (e) {
                console.error('판매 처리 중 오류:', e);
                ws.send(JSON.stringify({
                  type: 'chat',
                  text: `[${time}] ⚠️ 판매 처리 중 오류가 발생했습니다.`
                }));
              }
            })();
            
            return;
          }

          // 💰 특정 물고기 판매하기
          const sellMatch = text.match(/^판매하기\s+(\S+)\s+(\d+)$/);
          if (sellMatch) {
            (async () => {
              try {
                const fishName = sellMatch[1];
                const quantity = parseInt(sellMatch[2]);
                
                console.log(`특정 물고기 판매 시도: ${userId}, ${fishName}, ${quantity}`);
                
                // 인벤토리 가져오기
                let inventoryDoc = await Inventory.findOne({ userId });
                if (!inventoryDoc) {
                  ws.send(JSON.stringify({
                    type: 'chat',
                    text: `[${time}] ⚠️ 인벤토리가 존재하지 않습니다.`
                  }));
                  return;
                }
                
                let items = {};
                if (inventoryDoc.items instanceof Map) {
                  // Map인 경우
                  for (const [key, value] of inventoryDoc.items.entries()) {
                    items[key] = value;
                  }
                } else if (inventoryDoc.items && typeof inventoryDoc.items === 'object') {
                  // 객체인 경우
                  items = {...inventoryDoc.items};
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
                const currentCount = items[fishName] || 0;
                if (currentCount < quantity) {
                  ws.send(JSON.stringify({
                    type: 'chat',
                    text: `[${time}] ⚠️ ${fishName}을(를) ${quantity}개 판매하려면 최소한 ${quantity}개가 필요합니다. 현재 ${currentCount}개 보유 중.`
                  }));
                  return;
                }
                
                // 판매 금액 계산 (악세사리 보너스 적용)
                const accessory = equippedAccessory.get(userId) || accessoryNames[0];
                let bonusMultiplier = 1.0;
                
                switch(accessory) {
                  case "오래된반지": bonusMultiplier = 1.08; break;
                  case "은목걸이": bonusMultiplier = 1.16; break;
                  case "금귀걸이": bonusMultiplier = 1.24; break;
                  case "마법의펜던트": bonusMultiplier = 1.32; break;
                  case "에메랄드브로치": bonusMultiplier = 1.40; break;
                  case "토파즈이어링": bonusMultiplier = 1.48; break;
                  case "자수정팔찌": bonusMultiplier = 1.56; break;
                  case "백금티아라": bonusMultiplier = 1.64; break;
                  case "만드라고라허브": bonusMultiplier = 1.72; break;
                  case "에테르나무묘목": bonusMultiplier = 1.84; break;
                  case "몽마의조각상": bonusMultiplier = 1.92; break;
                  case "마카롱훈장": bonusMultiplier = 2.0; break;
                  case "빛나는마력순환체": bonusMultiplier = 2.08; break;
                  default: bonusMultiplier = 1.0; break;
                }
                
                const earned = Math.floor(fish.price * quantity * bonusMultiplier);
                
                // 물고기 삭제 및 골드 획득
                if (quantity >= currentCount) {
                  // 물고기 완전히 제거
                  delete items[fishName];
                  
                  // MongoDB 업데이트
                  await Inventory.updateOne(
                    { userId },
                    { $unset: { [`items.${fishName}`]: "" } }
                  );
                } else {
                  // 물고기 부분 감소
                  items[fishName] = currentCount - quantity;
                  
                  // MongoDB 업데이트
                  await Inventory.updateOne(
                    { userId },
                    { $set: { [`items.${fishName}`]: currentCount - quantity } }
                  );
                }
                
                // 골드 업데이트
                let goldDoc = await Gold.findOne({ userId });
                const currentGold = goldDoc ? goldDoc.amount : 0;
                const newGoldAmount = currentGold + earned;
                
                await Gold.updateOne(
                  { userId },
                  { $set: { amount: newGoldAmount } },
                  { upsert: true }
                );
                
                // 메모리 데이터 업데이트
                inventories.set(userId, items);
                userGold.set(userId, newGoldAmount);
                
                console.log('판매 후 물고기 수량:', items[fishName] || 0);
                console.log('판매 후 골드:', newGoldAmount);
                
                // 판매 결과 메시지
                const result = `[${time}] 💰 ${nickname}님이 ${fishName} ${quantity}마리를 판매하여 ${formatPrice(earned)}원을 획득했습니다! 현재 골드: ${formatPrice(newGoldAmount)}원`;
                saveLog(room, result, nickname, userId);
                broadcast(room, { type: 'chat', text: result });
              } catch (e) {
                console.error('특정 물고기 판매 처리 중 오류:', e);
                ws.send(JSON.stringify({
                  type: 'chat',
                  text: `[${time}] ⚠️ 판매 처리 중 오류가 발생했습니다. (오류: ${e.message})`
                }));
              }
            })();
            
            return;
          }
          
          // 물고기 분해 기능
          const decomposeMatch = text.match(/^분해하기\s+(\S+)\s+(\d+)(\s+(.+))?$/);
          if (decomposeMatch) {
            const fishName = decomposeMatch[1];
            const quantity = parseInt(decomposeMatch[2]);
            const option = decomposeMatch[4]; // 스타피쉬 분해 옵션 (별조각 또는 이벤트아이템)
            
            const inv = inventories.get(userId) || {};
            
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
                text: `[${time}] ⚠️ ${fishName}을(를) ${quantity}개 분해하려면 최소한 ${quantity}개가 필요합니다. 현재 ${currentCount}개 보유 중.`
              }));
              return;
            }
            
            // 스타피쉬 분해 처리 (옵션에 따라 다르게 처리)
            if (fishName === '스타피쉬') {
              if (!option) {
                // 옵션이 없는 경우 선택 메시지 전송
                pendingDecomposition.set(userId, { fishName, quantity });
                ws.send(JSON.stringify({
                  type: 'chat',
                  text: `[${time}] 스타피쉬 분해 옵션을 선택해주세요. '분해하기 스타피쉬 ${quantity} 별조각' 또는 '분해하기 스타피쉬 ${quantity} 이벤트아이템'`
                }));
                return;
              }
              
              if (option === '별조각') {
                // 별조각 지급
                inv[fishName] -= quantity;
                if (inv[fishName] <= 0) delete inv[fishName];
                
                const materialName = '별조각';
                inv[materialName] = (inv[materialName] || 0) + quantity;
                
                inventories.set(userId, inv);
                
                // 결과 메시지
                const result = `[${time}] 🔧 ${nickname}님이 ${fishName} ${quantity}마리를 분해하여 ${materialName} ${quantity}개를 얻었습니다!`;
                saveLog(room, result, nickname, userId);
                broadcast(room, { type: 'chat', text: result });
              }
              else if (option === '이벤트아이템') {
                // 이벤트 아이템 지급 (랜덤 알파벳)
                inv[fishName] -= quantity;
                if (inv[fishName] <= 0) delete inv[fishName];
                
                const eventLetters = ['A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'O', 'P', 'R', 'S', 'T', 'Y'];
                let resultItems = '';
                
                for (let i = 0; i < quantity; i++) {
                  const randomIndex = Math.floor(Math.random() * eventLetters.length);
                  const letter = eventLetters[randomIndex];
                  inv[letter] = (inv[letter] || 0) + 1;
                  
                  if (i > 0) resultItems += ', ';
                  resultItems += letter;
                }
                
                inventories.set(userId, inv);
                
                // 결과 메시지
                const result = `[${time}] 🔧 ${nickname}님이 ${fishName} ${quantity}마리를 분해하여 이벤트 아이템을 얻었습니다: ${resultItems}`;
                saveLog(room, result, nickname, userId);
                broadcast(room, { type: 'chat', text: result });
              }
              else {
                ws.send(JSON.stringify({
                  type: 'chat',
                  text: `[${time}] ⚠️ 잘못된 옵션입니다. 스타피쉬 분해 옵션은 '별조각' 또는 '이벤트아이템'이어야 합니다.`
                }));
                return;
              }
            }
            else {
              // 일반 물고기 분해
              inv[fishName] -= quantity;
              if (inv[fishName] <= 0) delete inv[fishName];
              
              const materialName = fish.material;
              inv[materialName] = (inv[materialName] || 0) + quantity;
              
              inventories.set(userId, inv);
              
              // 결과 메시지
              const result = `[${time}] 🔧 ${nickname}님이 ${fishName} ${quantity}마리를 분해하여 ${materialName} ${quantity}개를 얻었습니다!`;
              saveLog(room, result, nickname, userId);
              broadcast(room, { type: 'chat', text: result });
            }
            
            // 데이터베이스 저장
            saveDatabase();
            return;
          }
          
          // 전체판매 명령어
          if (text === '전체판매') {
            const inv = inventories.get(userId) || {};
            let earned = 0;
            let soldAny = false;
            let soldFishDetails = [];
            
            // 모든 물고기 순회하며 판매 처리 (스타피쉬 제외)
            for (const fish of fishTypes) {
              const count = inv[fish.name] || 0;
              // 스타피쉬는 판매하지 않음
              if (fish.name === '스타피쉬' || count <= 0) continue;
              
              const fishEarned = count * fish.price;
              earned += fishEarned;
              soldAny = true;
              soldFishDetails.push(`${fish.name} ${count}마리 (${formatPrice(fishEarned)}원)`);
              delete inv[fish.name];
            }
            
            if (!soldAny) {
              ws.send(JSON.stringify({
                type: 'chat',
                text: `[${time}] ⚠️ 판매할 물고기가 없습니다.`
              }));
              return;
            }
            
            // 판매 금액 계산 (악세사리 보너스 적용)
            const accessory = equippedAccessory.get(userId) || accessoryNames[0];
            let bonusMultiplier = 1.0;
            
            switch(accessory) {
              case "오래된반지": bonusMultiplier = 1.08; break;
              case "은목걸이": bonusMultiplier = 1.16; break;
              case "금귀걸이": bonusMultiplier = 1.24; break;
              case "마법의펜던트": bonusMultiplier = 1.32; break;
              case "에메랄드브로치": bonusMultiplier = 1.40; break;
              case "토파즈이어링": bonusMultiplier = 1.48; break;
              case "자수정팔찌": bonusMultiplier = 1.56; break;
              case "백금티아라": bonusMultiplier = 1.64; break;
              case "만드라고라허브": bonusMultiplier = 1.72; break;
              case "에테르나무묘목": bonusMultiplier = 1.84; break;
              case "몽마의조각상": bonusMultiplier = 1.92; break;
              case "마카롱훈장": bonusMultiplier = 2.0; break;
              case "빛나는마력순환체": bonusMultiplier = 2.08; break;
              default: bonusMultiplier = 1.0; break;
            }
            
            const finalEarned = Math.floor(earned * bonusMultiplier);
            
            // 골드 추가
            userGold.set(userId, (userGold.get(userId) || 0) + finalEarned);
            
            // 인벤토리 업데이트
            inventories.set(userId, inv);
            
            // 판매 결과 메시지 (판매한 물고기 상세 정보 포함)
            let result = `[${time}] 💰 ${nickname}님이 다음 물고기를 판매했습니다:\n`;
            result += soldFishDetails.join('\n');
            
            if (bonusMultiplier > 1.0) {
              result += `\n\n악세사리(${accessory}) 판매 보너스 ${Math.floor((bonusMultiplier - 1) * 100)}% 적용!`;
            }
            
            result += `\n\n총 획득 골드: ${formatPrice(finalEarned)}원\n현재 골드: ${formatPrice(userGold.get(userId))}원`;
            
            saveLog(room, result, nickname, userId);
            ws.send(JSON.stringify({ type: 'chat', text: result }));
            
            // 간소화된 알림을 다른 사용자에게 전송
            const publicMsg = `[${time}] 💰 ${nickname}님이 물고기를 판매하여 ${formatPrice(finalEarned)}원을 획득했습니다!`;
            for (const [client, info] of clients) {
              if (client !== ws && info.room === room) {
                client.send(JSON.stringify({ type: 'chat', text: publicMsg }));
              }
            }
            
            // 데이터베이스 저장
            saveDatabase();
            return;
          }
          
          // 일반 판매 명령어 안내
          if (text === '판매하기') {
            ws.send(JSON.stringify({
              type: 'chat',
              text: `[${time}] ℹ️ 사용법: '판매하기 [물고기이름] [수량]'. 예: '판매하기 타코문어 5'`
            }));
            return;
          }

          // 📦 인벤토리 조회
          if (text === '인벤토리') {
            const inventoryDisplay = showInventory(userId, nickname);
            ws.send(JSON.stringify({
              type: 'chat',
              text: inventoryDisplay
            }));
            return;
          }

          // 일반 채팅 메시지
          const formatted = `[${time}] ${nickname}: ${text}`;
          saveLog(room, formatted, nickname, userId).catch(e => console.error("일반 채팅 로그 저장 에러:", e));
          broadcast(room, { type: 'chat', text: formatted });
        }
      });

      ws.on('close', () => {
        const info = clients.get(ws);
        if (info) {
          const { nickname, room } = info;
          clients.delete(ws);
          const exitMsg = {
            type: 'leave',
            text: `[${getTime()}] ❌ ${nickname}님이 퇴장했습니다.`,
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
