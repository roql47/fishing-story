const mongoose = require('mongoose');

// MongoDB 연결 설정
let mongoConnected = false;

function connectToMongoDB() {
  mongoose.connect('mongodb+srv://roql47:'+encodeURIComponent('wiztech1')+'@cluster0.i5hmbzr.mongodb.net/?retryWrites=true&w=majority', {
    dbName: 'fishing_game',  // 명시적으로 데이터베이스 이름 지정
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 15000, // 서버 선택 타임아웃 15초
    socketTimeoutMS: 45000, // 소켓 타임아웃 45초
    connectTimeoutMS: 30000 // 연결 타임아웃 30초
  }).then(() => {
    console.log('MongoDB Atlas 연결 성공 - fishing_game 데이터베이스');
    mongoConnected = true;
  }).catch((err) => {
    console.error('MongoDB Atlas 연결 실패:', err);
    mongoConnected = false;
    // 10초 후에 재연결 시도
    setTimeout(connectToMongoDB, 10000);
  });
}

// 연결 끊김 감지 및 재연결
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB 연결이 끊어졌습니다. 재연결을 시도합니다...');
  mongoConnected = false;
  setTimeout(connectToMongoDB, 5000);
});

// 스키마 정의
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  uuid: { type: String, required: true, unique: true }
});

const inventorySchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  items: { type: Map, of: Number, default: {} }
});

const goldSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  amount: { type: Number, default: 0 }
});

// 낚시 스킬 레벨 스키마 추가
const fishingSkillSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  level: { type: Number, default: 1 }
});

// 채팅 로그를 위한 스키마 추가
const chatLogSchema = new mongoose.Schema({
  room: { type: String, required: true },
  content: { type: String, required: true },
  username: { type: String, required: false, default: 'system' },
  userId: { type: String, required: false, default: 'system' },
  timestamp: { type: Date, default: Date.now }
});

// 동료 스키마 추가
const companionSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  companions: [{
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, required: true },
    bonus: { type: String, required: true },
    acquiredAt: { type: Date, default: Date.now }
  }]
});

const User = mongoose.model('User', userSchema);
const Inventory = mongoose.model('Inventory', inventorySchema);
const Gold = mongoose.model('Gold', goldSchema);
const FishingSkill = mongoose.model('FishingSkill', fishingSkillSchema);
const ChatLog = mongoose.model('ChatLog', chatLogSchema);
const Companion = mongoose.model('Companion', companionSchema);

// 초기 연결 시도
connectToMongoDB();

// 데이터베이스 연결 상태 확인 함수
function isConnected() {
  return mongoConnected;
}

module.exports = {
  User,
  Inventory,
  Gold,
  FishingSkill,
  ChatLog,
  Companion,
  isConnected,
  connectToMongoDB
}; 
