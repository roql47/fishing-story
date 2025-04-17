const WebSocket = require('ws');
const { 
  inventories, userGold, equippedRod, equippedAccessory, rodEnhancement,
  fishingSkills, lastFishingTime, pendingDecomposition,
  formatPrice, getTime, autoEquip, showInventory, getRandomFish, saveLog, saveDatabase
} = require('../utils/gameUtils');
const { fishTypes, catchProbabilities, rodNames, accessoryNames } = require('../data/gameData');

// WebSocket 클라이언트 매핑
const clients = new Map(); // Map: WebSocket → { userId, nickname, room }

// 유저 목록 브로드캐스트
function broadcastUserList(room) {
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

// 메시지 브로드캐스트
function broadcast(room, messageObj) {
  const json = JSON.stringify(messageObj);
  for (const [client, info] of clients) {
    if (client.readyState === WebSocket.OPEN && info.room === room) {
      client.send(json);
    }
  }
}

// WebSocket 설정
function setupWebSocket(server) {
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
        const info = {
          type: 'userInfo',
          userId: targetUserId,
          inventory: inventories.get(targetUserId) || {},
          gold: userGold.get(targetUserId) || 0
        };
        ws.send(JSON.stringify(info));
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
        if (!inventories.has(userId)) {
          inventories.set(userId, {});
          saveDatabase();
        }
        if (!userGold.has(userId)) {
          userGold.set(userId, 0);
          saveDatabase();
        }

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
        
        // 모든 참여자에게 최신 참여자 목록 전송하기
        broadcastUserList(room);
        
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
            // 골드 차감
            userGold.set(userId, gold - price);
            
            // 인벤토리에 낚시대 추가
            inv[item] = (inv[item] || 0) + 1;
            inventories.set(userId, inv);
            
            // 자동 장착
            autoEquip(userId);
            
            purchaseSuccessful = true;
            
            // 구매 성공 메시지
            const result = `[${time}] 🎣 ${nickname}님이 ${item}을(를) 구매했습니다! (남은 골드: ${formatPrice(gold - price)}원)`;
            saveLog(room, result);
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
              // 골드 차감
              userGold.set(userId, gold - price);
              
              // 인벤토리에 악세사리 추가
              inv[item] = (inv[item] || 0) + 1;
              inventories.set(userId, inv);
              
              // 자동 장착
              autoEquip(userId);
              
              purchaseSuccessful = true;
              
              // 구매 성공 메시지
              const result = `[${time}] 💍 ${nickname}님이 ${item}을(를) 구매했습니다! (남은 골드: ${formatPrice(gold - price)}원)`;
              saveLog(room, result);
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
          handleFishing(ws, info, time);
          return;
        }

        // 💰 판매
        if (text === '판매') {
          handleSellAll(ws, info, time);
          return;
        }

        // 💰 특정 물고기 판매하기
        const sellMatch = text.match(/^판매하기\s+(\S+)\s+(\d+)$/);
        if (sellMatch) {
          handleSellFish(ws, info, sellMatch, time);
          return;
        }
        
        // 물고기 분해 기능
        const decomposeMatch = text.match(/^분해하기\s+(\S+)\s+(\d+)(\s+(.+))?$/);
        if (decomposeMatch) {
          handleDecomposeFish(ws, info, decomposeMatch, time);
          return;
        }
        
        // 전체판매 명령어
        if (text === '전체판매') {
          handleSellAll(ws, info, time);
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
        saveLog(room, formatted);
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
        broadcastUserList(room);
      }
    });
  });
  
  return wss;
}

// 낚시하기 처리 함수
function handleFishing(ws, info, time) {
  const { userId, nickname, room } = info;
  const currentTime = Date.now();
  
  // 낚시 쿨다운 계산 (악세사리에 따른 쿨다운 감소)
  let cooldownTime = 300000; // 기본 5분
  const accessory = equippedAccessory.get(userId) || accessoryNames[0];
  
  switch(accessory) {
    case "오래된반지": cooldownTime = 285000; break; // 4분 45초
    case "은목걸이": cooldownTime = 270000; break; // 4분 30초
    case "금귀걸이": cooldownTime = 255000; break; // 4분 15초
    case "마법의펜던트": cooldownTime = 240000; break; // 4분
    default: cooldownTime = 300000; break; // 5분
  }
  
  if (lastFishingTime.has(userId) && (currentTime - lastFishingTime.get(userId)) < cooldownTime) {
    const remainingTime = Math.ceil((cooldownTime - (currentTime - lastFishingTime.get(userId))) / 1000);
    ws.send(JSON.stringify({
      type: 'chat',
      text: `[${time}] ⏳ ${remainingTime}초 후에 다시 낚시할 수 있습니다.`
    }));
    return;
  }
  
  // 랜덤 물고기 획득
  const selectedFish = getRandomFish(userId);
  
  // 인벤토리 및 낚시 횟수 업데이트
  const inv = inventories.get(userId) || {};
  inv[selectedFish.name] = (inv[selectedFish.name] || 0) + 1;
  inventories.set(userId, inv);
  
  // 마지막 낚시 시간 업데이트
  lastFishingTime.set(userId, currentTime);
  
  // 결과 메시지
  const result = `[${time}] 🎣 ${nickname}님이 '${selectedFish.name}'(을)를 낚았습니다!`;
  saveLog(room, result);
  broadcast(room, { type: 'chat', text: result });
  
  // 데이터베이스 저장
  saveDatabase();
}

// 물고기 판매 처리 함수
function handleSellFish(ws, info, match, time) {
  const { userId, nickname, room } = info;
  const fishName = match[1];
  const quantity = parseInt(match[2]);
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
      text: `[${time}] ⚠️ ${fishName}을(를) ${quantity}개 판매하려면 최소한 ${quantity}개가 필요합니다. 현재 ${currentCount}개 보유 중.`
    }));
    return;
  }
  
  // 판매 금액 계산 (악세사리 보너스 적용)
  const accessory = equippedAccessory.get(userId) || accessoryNames[0];
  let bonusMultiplier = 1.0;
  
  switch(accessory) {
    case "오래된반지": bonusMultiplier = 1.05; break;
    case "은목걸이": bonusMultiplier = 1.10; break;
    case "금귀걸이": bonusMultiplier = 1.15; break;
    case "마법의펜던트": bonusMultiplier = 1.20; break;
    default: bonusMultiplier = 1.0; break;
  }
  
  const earned = Math.floor(fish.price * quantity * bonusMultiplier);
  
  // 물고기 판매 및 골드 획득
  inv[fishName] -= quantity;
  if (inv[fishName] <= 0) delete inv[fishName];
  
  userGold.set(userId, (userGold.get(userId) || 0) + earned);
  inventories.set(userId, inv);
  
  // 판매 결과 메시지
  const result = `[${time}] 💰 ${nickname}님이 ${fishName} ${quantity}마리를 판매하여 ${formatPrice(earned)}원을 획득했습니다! 현재 골드: ${formatPrice(userGold.get(userId))}원`;
  saveLog(room, result);
  broadcast(room, { type: 'chat', text: result });
  
  // 데이터베이스 저장
  saveDatabase();
}

// 모든 물고기 판매 처리 함수
function handleSellAll(ws, info, time) {
  const { userId, nickname, room } = info;
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
    case "오래된반지": bonusMultiplier = 1.05; break;
    case "은목걸이": bonusMultiplier = 1.10; break;
    case "금귀걸이": bonusMultiplier = 1.15; break;
    case "마법의펜던트": bonusMultiplier = 1.20; break;
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
  
  saveLog(room, result);
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
}

// 물고기 분해 처리 함수
function handleDecomposeFish(ws, info, match, time) {
  const { userId, nickname, room } = info;
  const fishName = match[1];
  const quantity = parseInt(match[2]);
  const option = match[4]; // 스타피쉬 분해 옵션 (별조각 또는 이벤트아이템)
  
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
      saveLog(room, result);
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
      saveLog(room, result);
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
    saveLog(room, result);
    broadcast(room, { type: 'chat', text: result });
  }
  
  // 데이터베이스 저장
  saveDatabase();
}

module.exports = {
  setupWebSocket,
  broadcast,
  clients
}; 
