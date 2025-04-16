const fs = require('fs');
const path = require('path');
const { fishTypes, rodNames, accessoryNames } = require('../data/gameData');
const { Inventory, Gold, isConnected, User } = require('../models/database');
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

// 랜덤 물고기 획득 함수
function getRandomFish(userId) {
  const skillLevel = fishingSkills.get(userId) || 0;
  let fishStartIndex = 0, fishEndIndex = 10;
  
  if (skillLevel >= 5) {
    fishStartIndex = 1;
    fishEndIndex = 11;
  }
  if (skillLevel >= 10) {
    fishStartIndex = 2;
    fishEndIndex = 12;
  }
  if (skillLevel >= 15) {
    fishStartIndex = 3;
    fishEndIndex = 13;
  }
  
  // 레벨별로 더 많은 구간 추가
  if (skillLevel >= 20) fishStartIndex = 4;
  if (skillLevel >= 25) fishStartIndex = 5;
  if (skillLevel >= 30) fishStartIndex = 6;
  
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

// 데이터베이스에서 기존 데이터를 불러오기
async function loadDatabase() {
  try {
    const inventoriesData = await Inventory.find({});
    const goldData = await Gold.find({});
    
    for (const inv of inventoriesData) {
      inventories.set(inv.userId, inv.items);
    }
    
    for (const gold of goldData) {
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
    console.log('데이터베이스 저장 완료');
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
  saveUsers
}; 