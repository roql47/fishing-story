# 낚시 게임 (Fishing Game)

웹소켓 기반의 실시간 낚시 게임입니다. 사용자들은 채팅방에 참여하여 낚시를 하고, 물고기를 모으고, 판매하며 골드를 획득할 수 있습니다.

## 주요 기능

- 실시간 채팅 기능
- 물고기 낚기 및 판매
- 재료 분해 시스템
- 장비 구매 및 자동 장착
- 관리자 기능 (골드, 물고기, 낚싯대, 악세서리 관리)

## 설치 방법

```bash
# 저장소 복제
git clone https://github.com/roql47/fishing-story.git

# 디렉토리 이동
cd fishing-story

# 의존성 설치
npm install

# 서버 실행
npm start
```

## 사용 방법

1. 서버 실행 후 웹 브라우저에서 로그인
2. 닉네임과 방 이름을 입력하여 게임에 참여
3. 채팅창에 '낚시하기' 명령어를 입력하여 물고기 낚기
4. '판매하기', '전체판매', '인벤토리' 등의 명령어를 사용하여 게임 진행

## 기술 스택

- Node.js
- Express
- WebSocket (ws)
- MongoDB
- HTML/CSS/JavaScript 
