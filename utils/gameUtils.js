const fs = require('fs');
const path = require('path');
const { fishTypes, rodNames, accessoryNames } = require('../data/gameData');
const { Inventory, Gold, isConnected, User, FishingSkill } = require('../models/database');
const mongoose = require('mongoose');

// 게임 상태 데이터 (메모리 데이터)
const inventories = new Map();        // Map: userId → { 물고기명: 개수 }
const userGold = new Map();          // Map: userId → 골드 (숫자)
const equippedRod = new Map();        // 장착된 낚시대
const equippedAccessory = new Map();  // 장착된 악세사리
const rodEnhancement = new Map();     // 낚시대 강화 수치
const fishingSkills = new Map();      // 낚시 실력 (레벨)
const lastFishingTime = new Map();    // 마지막 낚시 시간
const pendingDecomposition = new Map(); // { userId: { fishName, quantity } }

// 포맷 가격 유틸리티 함수
function formatPrice(price) {
  // price가 undefined, null일 경우 0을 기본값으로 사용
  price = price != null ? price : 0;
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 현재 시간 가져오기
function getTime() {
  return new Date().toLocaleTimeString();
}

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
    // 몽구스 내부 객체 필터링
    if (itemName.startsWith('$__') || userInventory[itemName] <= 0) continue;
    
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
  result += `🎯 낚시 스킬 레벨: ${fishingSkills.get(userId) || 0}\n\n`;
  
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

// 랜덤 물고기 획득 함수
function getRandomFish(userId) {
  const skillLevel = fishingSkills.get(userId) || 0;
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
  
  // 희귀 물고기 (스타피쉬) 확률 체크
  if (Math.random() < 0.005) {
    return fishTypes[fishTypes.length - 1]; // 스타피쉬
  }
  
  const rand = Math.random() * 100;
  let cumulativeProbability = 0;
  
  for (let i = 0; i < Math.min(effectiveFishTypes.length, rodNames.length); i++) {
    cumulativeProbability += i < rodNames.length ? rodNames[i] || 1 : 0.5;
    if (rand < cumulativeProbability) {
      return effectiveFishTypes[i];
    }
  }
  
  // 기본값 설정 (확률이 맞지 않는 경우를 대비)
  return effectiveFishTypes[0];
}

// 채팅 로그 저장 함수
async function saveLog(room, content) {
  // 로컬 파일 시스템에 저장
  try {
    const logDir = path.join(__dirname, '..', 'chatlogs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
    const filePath = path.join(logDir, `${room}.txt`);
    fs.appendFileSync(filePath, content + '\n');
  } catch (e) {
    console.error("채팅 로그 파일 저장 에러:", e);
  }
}

// 탐사 기능 관련 데이터 및 함수
const pendingBattle = new Map(); // 전투 대기 상태
const exploreCooldown = new Map(); // 탐사 쿨다운 시간

// 물고기 재료와 연관된 물고기 매핑
const fishMaterialMapping = {
  "문어다리": "타코문어",
  "고등어비늘": "풀고등어",
  "당고": "경단붕어",
  "버터조각": "버터오징어",
  "간장종지": "간장새우",
  "옥수수콘": "물수수",
  "버터": "정어리파이",
  "얼음조각": "얼음상어",
  "오징어먹물": "스퀄스퀴드",
  "백년송": "백년송거북",
  "후춧가루": "고스피쉬",
  "석화": "유령치",
  "핫소스": "바이트독",
  "펌킨조각": "호박고래",
  "꽃술": "바이킹조개",
  "프레첼": "천사해파리",
  "베놈": "악마복어",
  "장어꼬리": "칠성장어",
  "아인스바인": "닥터블랙",
  "헤븐즈서펀트": "해룡",
  "집게다리": "메카핫킹크랩",
  "이즈니버터": "램프리",
  "라벤더오일": "마지막잎새",
  "샤베트": "아이스브리더",
  "마법의정수": "해신",
  "휘핑크림": "핑키피쉬",
  "와플리머신": "콘토퍼스",
  "베르쥬스": "딥원",
  "안쵸비": "큐틀루",
  "핑크멜로우": "꽃술나리",
  "와일드갈릭": "다무스",
  "그루누아": "수호자",
  "시더플랭크": "태양가사리",
  "세비체": "빅파더펭귄",
  "타파스": "크레인터틀",
  "트러플리소토": "CSP-765 조립식생선",
  "캐비아소스": "데드케이지",
  "푸아그라에스푸마": "다크암모나이트",
  "샴페인젤리": "조가비여인",
  "금박마카롱": "10개통고래",
  "별조각": "스타피쉬"
};

// 물고기 체력 매핑
const fishBaseHPMapping = {
  "타코문어": 15,
  "풀고등어": 25,
  "경단붕어": 35,
  "버터오징어": 55,
  "간장새우": 80,
  "물수수": 115,
  "정어리파이": 160,
  "얼음상어": 215,
  "스퀄스퀴드": 280,
  "백년송거북": 355,
  "고스피쉬": 440,
  "유령치": 525,
  "바이트독": 640,
  "호박고래": 755,
  "바이킹조개": 880,
  "천사해파리": 1015,
  "악마복어": 1160,
  "칠성장어": 1315,
  "닥터블랙": 1480,
  "해룡": 1655,
  "메카핫킹크랩": 1840,
  "램프리": 2035,
  "마지막잎새": 2240,
  "아이스브리더": 2455,
  "해신": 2680,
  "핑키피쉬": 2915,
  "콘토퍼스": 3160,
  "딥원": 3415,
  "큐틀루": 3680,
  "꽃술나리": 3955,
  "다무스": 4240,
  "수호자": 4535,
  "태양가사리": 4840,
  "빅파더펭귄": 5155,
  "크레인터틀": 5480,
  "CSP-765 조립식생선": 5815,
  "데드케이지": 6160,
  "다크암모나이트": 6515,
  "조가비여인": 6880,
  "10개통고래": 7255
};

// 물고기 보상 가치 매핑
const fishRewardMapping = {};
fishTypes.forEach((fish, index) => {
  fishRewardMapping[fish.name] = index + 1;
});

// 기본 공격력 계산 함수 (낚시실력)
function getFishingAttackPower(userId) {
  const fishingSkill = fishingSkills.get(userId) || 0;
  let attackPower = 0;
  
  switch (fishingSkill) {
    case 0: attackPower = Math.floor(Math.random() * 2) + 1; break;
    case 1: attackPower = Math.floor(Math.random() * 2) + 2; break;
    case 2: attackPower = Math.floor(Math.random() * 4) + 2; break;
    case 3: attackPower = Math.floor(Math.random() * 6) + 3; break;
    case 4: attackPower = Math.floor(Math.random() * 9) + 4; break;
    case 5: attackPower = Math.floor(Math.random() * 12) + 6; break;
    case 6: attackPower = Math.floor(Math.random() * 15) + 9; break;
    case 7: attackPower = Math.floor(Math.random() * 18) + 13; break;
    case 8: attackPower = Math.floor(Math.random() * 21) + 18; break;
    case 9: attackPower = Math.floor(Math.random() * 24) + 24; break;
    case 10: attackPower = Math.floor(Math.random() * 27) + 31; break;
    case 11: attackPower = Math.floor(Math.random() * 30) + 38; break;
    case 12: attackPower = Math.floor(Math.random() * 33) + 48; break;
    case 13: attackPower = Math.floor(Math.random() * 36) + 58; break;
    case 14: attackPower = Math.floor(Math.random() * 39) + 69; break;
    case 15: attackPower = Math.floor(Math.random() * 42) + 81; break;
    default: attackPower = 1 + fishingSkill; break;
  }
  
  return attackPower;
}

// 강화된 공격력 계산 (장비 보너스 적용)
function getEnhancedAttackPower(userId) {
  let baseAttack = getFishingAttackPower(userId);
  const rod = equippedRod.get(userId) || rodNames[0];
  const accessory = equippedAccessory.get(userId) || accessoryNames[0];
  const enhancement = rodEnhancement.get(userId) || 0;
  
  // 낚시대 보너스
  let rodBonus = 0;
  for (let i = 0; i < rodNames.length; i++) {
    if (rodNames[i] === rod) {
      rodBonus = i * 0.1; // 10% 씩 증가
      break;
    }
  }
  
  // 악세사리 보너스
  let accessoryBonus = 0;
  for (let i = 0; i < accessoryNames.length; i++) {
    if (accessoryNames[i] === accessory) {
      accessoryBonus = i * 0.05; // 5% 씩 증가
      break;
    }
  }
  
  // 강화 보너스 (강화 수치당 5% 증가)
  const enhancementBonus = enhancement * 0.05;
  
  // 최종 공격력 계산
  baseAttack = Math.floor(baseAttack * (1 + rodBonus + accessoryBonus + enhancementBonus));
  return baseAttack;
}

// 적 기본 체력 계산
function getBaseEnemyHP(originalFishName) {
  return fishBaseHPMapping[originalFishName] || 10;
}

// 탐사 시작 함수
function startExplore(userId, materialName, nickname) {
  console.log(`탐사 시도: ${userId}, 재료: ${materialName}, 인벤토리:`, inventories.get(userId));
  
  if (!inventories.has(userId)) {
    return `인벤토리가 존재하지 않습니다.`;
  }
  
  const userInventory = inventories.get(userId);
  console.log(`사용자 인벤토리:`, userInventory);
  
  // 재료 아이템 확인
  if (!userInventory[materialName] || userInventory[materialName] <= 0) {
    return `재료 아이템 ${materialName}(이)가 없습니다.`;
  }
  
  // 재료에 해당하는 물고기 찾기
  const originalFishName = fishMaterialMapping[materialName];
  if (!originalFishName) {
    return `재료 ${materialName}으로 생성 가능한 물고기가 없습니다.`;
  }
  
  // 쿨다운 확인
  const now = Date.now();
  const cooldownTime = 5 * 60 * 1000; // 5분
  
  if (exploreCooldown.has(userId) && (now - exploreCooldown.get(userId)) < cooldownTime) {
    const remaining = cooldownTime - (now - exploreCooldown.get(userId));
    const remainingSec = Math.floor(remaining / 1000);
    const minutes = Math.floor(remainingSec / 60);
    const seconds = remainingSec % 60;
    return `탐사 쿨타임 중입니다. 남은 시간: ${minutes}분 ${seconds}초`;
  }
  
  // 재료 소비
  userInventory[materialName]--;
  if (userInventory[materialName] <= 0) {
    delete userInventory[materialName];
  }
  inventories.set(userId, userInventory);
  console.log(`재료 소비 후 인벤토리:`, userInventory);
  
  // 쿨다운 설정
  exploreCooldown.set(userId, now);
  
  // 적 생성 (prefix에 따라 난이도 변화)
  const rand = Math.random() * 100;
  let prefix = "";
  let hpMulti = 1.0, rewardMulti = 1.0;
  
  if (rand < 70) { 
    prefix = "거대한"; 
  } else if (rand < 90) { 
    prefix = "변종된"; 
    hpMulti = 1.5; 
    rewardMulti = 1.5; 
  } else if (rand < 97) { 
    prefix = "심연의"; 
    hpMulti = 2.8; 
    rewardMulti = 3.0; 
  } else { 
    prefix = "깊은어둠의"; 
    hpMulti = 4.4; 
    rewardMulti = 5.0; 
  }
  
  const enemyName = prefix + " " + originalFishName;
  const baseHP = getBaseEnemyHP(originalFishName);
  const initialHP = Math.round(baseHP * hpMulti);
  
  // 전투 정보 저장
  pendingBattle.set(userId, {
    material: materialName,
    enemyName: enemyName,
    enemyHP: initialHP,
    initialHP: initialHP,
    originalFish: originalFishName,
    rewardMulti: rewardMulti
  });
  
  return `탐사 결과:\n----\n적: '${enemyName}' (HP: ${initialHP})\n----\n전투를 시작하려면 "전투시작"\n도망가려면 "도망가기"`;
}

// 전투 실행 함수
function executeBattle(userId, nickname) {
  if (!pendingBattle.has(userId)) {
    return "진행 중인 전투가 없습니다. 먼저 탐사를 진행하세요.";
  }
  
  const battleInfo = pendingBattle.get(userId);
  const enemyName = battleInfo.enemyName;
  let currentHP = battleInfo.enemyHP;
  const initialHP = battleInfo.initialHP;
  
  let battleLog = "";
  battleLog += `전투 시작! VS '${enemyName}' (HP: ${initialHP})\n`;
  battleLog += "\u200b".repeat(1000) + "\n";
  battleLog += "----\n";
  
  let victory = false;
  
  // 최대 10페이즈까지 전투 진행
  for (let phase = 1; phase <= 10; phase++) {
    battleLog += `Phase ${phase}:\n`;
    
    // 플레이어의 공격
    const playerAttack = getEnhancedAttackPower(userId);
    const prevHP = currentHP;
    currentHP -= playerAttack;
    if (currentHP < 0) currentHP = 0;
    
    const damageDealt = prevHP - currentHP;
    battleLog += `  ${nickname}의 공격! 데미지: ${damageDealt}\n`;
    battleLog += `  '${enemyName}'의 HP: ${prevHP} → ${currentHP} (${currentHP}/${initialHP})\n`;
    
    if (currentHP <= 0) {
      victory = true;
      battleLog += `★ 승리! ${phase}페이즈 만에 적을 제압했습니다.\n`;
      break;
    }
    
    battleLog += "----\n";
  }
  
  // 전투 결과 처리
  if (currentHP > 0) {
    // 패배
    battleLog += "☠ 패배: 10페이즈 진행 후에도 적의 체력이 남아있습니다.\n";
  } else {
    // 승리 - 호박석 보상 지급
    const baseReward = fishRewardMapping[battleInfo.originalFish] || 1;
    const rewardCount = Math.floor(baseReward * battleInfo.rewardMulti);
    battleLog += `보상: '호박석' ${rewardCount}개 지급!\n`;
    
    // 호박석 인벤토리에 추가
    const userInventory = inventories.get(userId) || {};
    userInventory["호박석"] = (userInventory["호박석"] || 0) + rewardCount;
    inventories.set(userId, userInventory);
  }
  
  // 전투 상태 제거
  pendingBattle.delete(userId);
  
  return battleLog;
}

// 전투 취소 함수
function cancelBattle(userId, nickname) {
  if (pendingBattle.has(userId)) {
    pendingBattle.delete(userId);
    
    // 쿨다운 감소 (5분에서 1분만 지난 것으로 처리)
    const now = Date.now();
    exploreCooldown.set(userId, now - (5 * 60 * 1000 - 1 * 60 * 1000));
    
    const remainingTime = 4 * 60; // 4분
    const minutes = Math.floor(remainingTime / 60);
    const seconds = remainingTime % 60;
    
    return `전투에서 도망쳤습니다. ${minutes}분 ${seconds}초의 탐사 쿨타임이 적용되었습니다.`;
  }
  
  return "진행 중인 전투가 없습니다.";
}

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
  console.log('saveDatabase 호출됨, MongoDB 연결 상태:', isConnected());
  
  if (!isConnected()) {
    console.log('MongoDB 연결이 준비되지 않아 데이터베이스 저장을 건너뜁니다.');
    return;
  }

  try {
    const savePromises = [];
    
    // 인벤토리 저장
    for (const [userId, items] of inventories) {
      // MongoDB에 올바르게 저장되도록 객체를 변환
      const itemsObject = {};
      for (const [key, value] of Object.entries(items)) {
        if (!key.startsWith('$') && !key.startsWith('_')) {
          itemsObject[key] = value;
        }
      }
      
      console.log(`인벤토리 저장 시도 (${userId}):`, itemsObject);
      
      savePromises.push(
        Inventory.findOneAndUpdate(
          { userId },
          { userId, items: itemsObject },
          { upsert: true, new: true }
        ).catch(e => console.error(`인벤토리 저장 에러 (${userId}):`, e))
      );
    }
    
    // 골드 저장
    for (const [userId, amount] of userGold) {
      console.log(`골드 저장 시도 (${userId}): ${amount}`);
      
      savePromises.push(
        Gold.findOneAndUpdate(
          { userId },
          { userId, amount },
          { upsert: true, new: true }
        ).catch(e => console.error(`골드 저장 에러 (${userId}):`, e))
      );
    }
    
    // 낚시 스킬 레벨 저장
    for (const [userId, level] of fishingSkills) {
      console.log(`낚시 스킬 레벨 저장 시도 (${userId}): ${level}`);
      
      savePromises.push(
        FishingSkill.findOneAndUpdate(
          { userId },
          { userId, level },
          { upsert: true, new: true }
        ).catch(e => console.error(`낚시 스킬 레벨 저장 에러 (${userId}):`, e))
      );
    }
    
    // 모든 저장 작업 병렬 처리
    const results = await Promise.allSettled(savePromises);
    console.log('데이터베이스 저장 완료, 결과:', 
      results.map(r => r.status === 'fulfilled' ? '성공' : '실패').join(', '));
  } catch (e) {
    console.error("데이터베이스 저장 에러:", e);
  }
}

// 유저 데이터베이스에서 기존 유저 데이터를 불러오기
async function loadUsers() {
  try {
    const usersData = await User.find({});
    const users = new Map();
    
    for (const user of usersData) {
      users.set(user.username, {
        password: user.password,
        uuid: user.uuid
      });
    }
    
    console.log('유저 데이터베이스 로드 완료');
    return users;
  } catch (e) {
    console.error("유저 데이터베이스 로드 에러:", e);
    return new Map();
  }
}

// 유저 데이터 저장
async function saveUsers(users) {
  try {
    for (const [username, data] of users) {
      await User.findOneAndUpdate(
        { username },
        { username, password: data.password, uuid: data.uuid },
        { upsert: true }
      );
    }
    console.log('유저 데이터베이스 저장 완료');
  } catch (e) {
    console.error("유저 데이터베이스 저장 에러:", e);
  }
}

module.exports = {
  inventories,
  userGold,
  equippedRod,
  equippedAccessory,
  rodEnhancement,
  fishingSkills,
  lastFishingTime,
  pendingDecomposition,
  formatPrice,
  getTime,
  autoEquip,
  showInventory,
  getRandomFish,
  saveLog,
  loadDatabase,
  saveDatabase,
  loadUsers,
  saveUsers,
  
  // 탐사 기능 내보내기
  getFishingAttackPower,
  getEnhancedAttackPower,
  startExplore,
  executeBattle,
  cancelBattle,
  pendingBattle,
  exploreCooldown,
  fishMaterialMapping,
  fishRewardMapping
}; 
