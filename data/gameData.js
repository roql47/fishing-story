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

// 낚시대 종류
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

// 악세서리 종류
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

// 관리자 키 설정
const ADMIN_KEY = 'admin_secret_key_12345';

module.exports = {
  fishTypes,
  catchProbabilities,
  rodNames,
  accessoryNames,
  ADMIN_KEY
}; 
