/*
  EyeCan Room - 통합 장치 제어 코드 (아두이노 우노 1개)

  핀 배치
    조명(MOSFET PWM)     -> 3번 핀
    커튼(연속회전 서보)     -> 5번 핀
    선풍기(Grove Mini Fan)-> 11번 핀 (주의: 우노는 3,5,6,9,10,11번만 PWM 지원. 4번은 PWM 불가)
    (D5/D6를 같이 쓸 때 선풍기 명령에 커튼 서보가 반응하는 현상이 있어, 두 핀을
     떨어뜨려 커튼=5번, 선풍기=11번으로 재배선함)
    카메라 좌우(Pan) 서보  -> 8번 핀
    카메라 상하(Tilt) 서보 -> 9번 핀

  사용 방법
    1) 시리얼 모니터(9600bps, Newline)를 엽니다.
    2) 메뉴에서 숫자 1~4를 입력해 제어할 장치를 선택합니다.
       1 = 카메라(Pan/Tilt)
       2 = 커튼(서보)
       3 = 조명
       4 = 선풍기
    3) 장치를 선택하면 그 장치 전용 명령을 계속 반복해서 입력할 수 있습니다.
       - 조명/선풍기: 0~10 숫자 (0=끔/정지, 10=최대) 를 원하는 만큼 계속 입력
       - 커튼: 연속회전 서보라 각도가 곧 속도/방향이다. o(열기 시작)/k(닫기 시작)/
               s(정지, c와 동일) — 열기/닫기를 누르면 감기/풀기가 끝나거나 정지를
               누를 때까지 계속 돈다. 숫자를 직접 입력하면 그 속도값으로 즉시 회전
               (0·180=최대 속도, 90=정지).
       - 카메라: w(위)/a(왼쪽)/s(아래)/d(오른쪽)/c(중앙 복귀) 를 원하는 만큼 계속 입력
    4) 다른 장치를 제어하고 싶으면 'm' 을 입력하면 메뉴로 돌아갑니다.
       (메뉴로 돌아가도 방금 설정한 상태는 그대로 유지됩니다)
*/

#include <Servo.h>

const int LIGHT_PIN = 3;
// D5/D6를 각각 커튼/선풍기로 나눠 썼을 때 한쪽 명령에 다른 쪽 장치가 반응하는
// 현상이 있어서(브레드보드 인접 핀 간섭으로 추정), 두 핀을 서로 멀리 떨어뜨려
// 재배선했다: 커튼=5번, 선풍기=11번(3,11은 Timer2 공유지만 analogWrite는 서로
// 독립적으로 듀티비를 설정할 수 있어 조명(3번)과 간섭 없음).
const int EXTRA_SERVO_PIN = 5;
const int FAN_PIN = 11;
const int CAM_PAN_PIN = 8;
const int CAM_TILT_PIN = 9;

const int STEP_SIZE = 45;
const int PAN_HOME_ANGLE = 90;
const int TILT_HOME_ANGLE = 20;
// 틸트가 0까지 내려가면 카메라가 바닥을 향해 너무 많이 숙여져서, 하한을 0 대신
// 이 값으로 둔다. 실측해서 더 적절한 값(더 낮게/높게)이 있으면 이 숫자만 바꾸면 된다.
const int TILT_MIN_ANGLE = 10;
const int EXTRA_HOME_ANGLE = 90;
const int FAN_MIN_PWM = 120;
const unsigned long MOTION_TICK_MS = 20;
const unsigned long MOTION_TIMEOUT_MS = 300;
const int MAX_VELOCITY_10 = 300;
const int SERIAL_BUFFER_SIZE = 64;

// 커튼 서보는 위치형이 아니라 연속회전(continuous rotation) 서보다 — write(각도)가
// "위치"가 아니라 "속도/방향"이다: 90=정지, 90보다 작을수록 한쪽 방향으로 빠르게,
// 90보다 클수록 반대 방향으로 빠르게 돈다. 그래서 감기/풀기는 고정 속도값을 한 번
// 써서 계속 돌게 두고, 정지는 90을 다시 써서 즉시 멈춘다 — 카메라처럼 각도를
// 서서히 늘려가는 램프를 쓰면 안 된다(그러면 속도가 점점 빨라지다 느려지는 꼴이 됨).
const int CURTAIN_OPEN_SPEED = 180;  // 최대 속도로 한쪽 방향(열기)
const int CURTAIN_CLOSE_SPEED = 0;   // 최대 속도로 반대 방향(닫기)

// 리밋 스위치가 없어서 아두이노는 커튼이 실제로 다 열렸는지/닫혔는지 알 방법이
// 없다 — 그래서 열기/닫기를 시작한 뒤 이 시간이 지나면 정지 명령을 못 받아도
// 안전하게 자동으로 멈춘다(실측: 한쪽 끝에서 반대쪽 끝까지 약 5초 — 여유를 두고
// 4.5초로 설정). 물론 그 전에 사용자가 '정지'를 보내면 그 즉시 멈춘다.
const unsigned long CURTAIN_MAX_RUN_MS = 4500;
unsigned long curtainStartedMs = 0;   // 0이면 지금 정지 상태(자동정지 타이머 비활성)

Servo extraServo;
Servo panServo;
Servo tiltServo;

int lightLevel = 0;
int fanLevel = 0;
int extraAngle = EXTRA_HOME_ANGLE;
int panAngle = PAN_HOME_ANGLE;
int tiltAngle = TILT_HOME_ANGLE;
float panPosition = PAN_HOME_ANGLE;
float tiltPosition = TILT_HOME_ANGLE;
int panVelocity10 = 0;
int tiltVelocity10 = 0;
unsigned long lastMotionTickMs = 0;
unsigned long lastVelocityCommandMs = 0;
char serialBuffer[SERIAL_BUFFER_SIZE];
byte serialLength = 0;
bool serialOverflow = false;

enum Mode { MODE_MENU, MODE_CAMERA, MODE_SERVO, MODE_LIGHT, MODE_FAN };
Mode currentMode = MODE_MENU;

void printMenu() {
  Serial.println();
  Serial.println(F("========== EyeCan Room 통합 제어 메뉴 =========="));
  Serial.print(F("1) 카메라(Pan/Tilt)   현재 Pan: "));
  Serial.print(panAngle);
  Serial.print(F("  Tilt: "));
  Serial.println(tiltAngle);

  Serial.print(F("2) 커튼(서보)         현재 각도: "));
  Serial.println(extraAngle);

  Serial.print(F("3) 조명               현재 단계: "));
  Serial.println(lightLevel);

  Serial.print(F("4) 선풍기             현재 단계: "));
  Serial.println(fanLevel);

  Serial.println(F("번호(1~4)를 입력해 제어할 장치를 선택하세요."));
  Serial.println(F("================================================="));
}

void backToMenu() {
  panVelocity10 = 0;
  tiltVelocity10 = 0;
  currentMode = MODE_MENU;
  printMenu();
}

bool checkReturnToMenu(String input) {
  input.trim();
  if (input.equalsIgnoreCase("m")) {
    backToMenu();
    return true;
  }
  return false;
}

bool isValidLevel(int level) {
  return level >= 0 && level <= 10;
}

int levelToLightPwm(int level) {
  return map(level, 0, 10, 0, 255);
}

int levelToFanPwm(int level) {
  if (level == 0) return 0;
  return map(level, 1, 10, FAN_MIN_PWM, 255);
}

void applyPwmLevel(int pin, int pwmValue) {
  analogWrite(pin, pwmValue);
}

void writeExtraServo() {
  extraServo.write(extraAngle);
}

void writeCameraServos() {
  panServo.write(panAngle);
  tiltServo.write(tiltAngle);
}

void stopCameraMotion() {
  panVelocity10 = 0;
  tiltVelocity10 = 0;
}

void stopCurtain() {
  curtainStartedMs = 0;
  extraAngle = EXTRA_HOME_ANGLE;
  writeExtraServo();
}

// loop()에서 매 반복 확인: 열기/닫기 시작 후 CURTAIN_MAX_RUN_MS가 지나면(리밋
// 스위치가 없어 정확한 완료 시점을 몰라도) 안전하게 자동 정지한다.
void updateCurtainSafety() {
  if (curtainStartedMs == 0) return;
  if (millis() - curtainStartedMs < CURTAIN_MAX_RUN_MS) return;
  stopCurtain();
  Serial.println(F("커튼 자동 정지 (최대 구동 시간 초과) | 계속 입력하거나 'm'으로 메뉴 복귀"));
}

void sendMotionAck(unsigned long commandId) {
  Serial.print(F("A "));
  Serial.print(commandId);
  Serial.print(F(" "));
  Serial.print((long)round(panPosition * 10.0));
  Serial.print(F(" "));
  Serial.println((long)round(tiltPosition * 10.0));
}

void sendMotionError(unsigned long commandId, const char* code) {
  stopCameraMotion();
  Serial.print(F("E "));
  Serial.print(commandId);
  Serial.print(F(" "));
  Serial.println(code);
}

bool handleMotionProtocol(const char* line) {
  if (line[0] != 'V' && line[0] != 'H' && line[0] != 'Q') return false;

  unsigned long commandId = 0;
  if (line[0] == 'V') {
    int nextPanVelocity10 = 0;
    int nextTiltVelocity10 = 0;
    if (sscanf(line, "V %lu %d %d", &commandId, &nextPanVelocity10, &nextTiltVelocity10) != 3) {
      sendMotionError(commandId, "BAD_FORMAT");
      return true;
    }
    if (abs(nextPanVelocity10) > MAX_VELOCITY_10 || abs(nextTiltVelocity10) > MAX_VELOCITY_10) {
      sendMotionError(commandId, "OUT_OF_RANGE");
      return true;
    }
    panVelocity10 = nextPanVelocity10;
    tiltVelocity10 = nextTiltVelocity10;
    lastVelocityCommandMs = millis();
    sendMotionAck(commandId);
    return true;
  }

  if (sscanf(line + 1, "%lu", &commandId) != 1) {
    sendMotionError(0, "BAD_FORMAT");
    return true;
  }
  if (line[0] == 'H') stopCameraMotion();
  sendMotionAck(commandId);
  return true;
}

void updateCameraMotion() {
  unsigned long now = millis();
  if (lastMotionTickMs == 0) lastMotionTickMs = now;
  if ((panVelocity10 != 0 || tiltVelocity10 != 0) && now - lastVelocityCommandMs > MOTION_TIMEOUT_MS) {
    stopCameraMotion();
  }
  if (now - lastMotionTickMs < MOTION_TICK_MS) return;

  float dt = (now - lastMotionTickMs) / 1000.0;
  lastMotionTickMs = now;
  if (panVelocity10 == 0 && tiltVelocity10 == 0) return;

  panPosition = constrain(panPosition + (panVelocity10 / 10.0) * dt, 0.0, 180.0);
  tiltPosition = constrain(tiltPosition + (tiltVelocity10 / 10.0) * dt, (float)TILT_MIN_ANGLE, 180.0);
  int nextPanAngle = round(panPosition);
  int nextTiltAngle = round(tiltPosition);
  if (nextPanAngle == panAngle && nextTiltAngle == tiltAngle) return;
  panAngle = nextPanAngle;
  tiltAngle = nextTiltAngle;
  writeCameraServos();
}

// WASD는 설치 점검과 수동 제어용 단계 이동이다. 웹의 실시간 시선 제어는 위의
// V/H/Q 프로토콜을 사용하며, 두 경로 모두 같은 panPosition/tiltPosition을 갱신한다.
// 문자 뒤에 숫자가 없으면 기존 기본값 STEP_SIZE(45도)를 그대로 사용한다.
bool moveCameraOnce(char direction, int stepSize) {
  stopCameraMotion();
  switch (direction) {
    case 'w':
      tiltAngle = constrain(tiltAngle + stepSize, TILT_MIN_ANGLE, 180);
      break;
    case 's':
      tiltAngle = constrain(tiltAngle - stepSize, TILT_MIN_ANGLE, 180);
      break;
    case 'a':
      panAngle = constrain(panAngle - stepSize, 0, 180);
      break;
    case 'd':
      panAngle = constrain(panAngle + stepSize, 0, 180);
      break;
    default:
      Serial.println(F("w(위)/a(왼쪽)/s(아래)/d(오른쪽)/c(중앙복귀)/m(메뉴복귀) 중 입력하세요."));
      return false;
  }
  panPosition = panAngle;
  tiltPosition = tiltAngle;
  return true;
}

void applyLight(String rawInput) {
  if (checkReturnToMenu(rawInput)) return;

  int level = rawInput.toInt();
  if (!isValidLevel(level)) {
    Serial.println(F("잘못된 입력입니다. 0~10 숫자를 입력하거나, 'm'으로 메뉴 복귀하세요."));
    return;
  }

  lightLevel = level;
  int pwmValue = levelToLightPwm(level);
  applyPwmLevel(LIGHT_PIN, pwmValue);

  Serial.print(F("조명 밝기 변경 -> Level "));
  Serial.print(level);
  Serial.print(F(" (PWM 값: "));
  Serial.print(pwmValue);
  Serial.println(F(") | 계속 입력하거나 'm'으로 메뉴 복귀"));
}

void applyFan(String rawInput) {
  if (checkReturnToMenu(rawInput)) return;

  int level = rawInput.toInt();
  if (!isValidLevel(level)) {
    Serial.println(F("잘못된 입력입니다. 0~10 숫자를 입력하거나, 'm'으로 메뉴 복귀하세요."));
    return;
  }

  fanLevel = level;
  int pwmValue = levelToFanPwm(level);
  applyPwmLevel(FAN_PIN, pwmValue);

  Serial.print(F("선풍기 속도 변경 -> Level "));
  Serial.print(level);
  Serial.print(F(" (PWM 값: "));
  Serial.print(pwmValue);
  Serial.println(F(") | 계속 입력하거나 'm'으로 메뉴 복귀"));
}

// 커튼 서보는 연속회전형이라 각도가 곧 속도/방향이다(90=정지). 그래서 여기 있는
// 모든 명령은 그 즉시 반영되는 단발성 쓰기일 뿐이고, 카메라 쪽과 달리 서서히
// 옮겨가는 램프가 필요 없다 — 열기/닫기는 고정 속도로 계속 돌게 두는 것 자체가
// "이동"이고, 정지는 90을 다시 써서 그 자리에서 즉시 멈춘다.
void applyExtraServo(String rawInput) {
  String input = rawInput;
  input.trim();

  if (checkReturnToMenu(input)) return;

  // c(중앙복귀)와 s(정지)는 이 서보에서는 같은 뜻이다 — 연속회전 서보의 "중앙"은
  // 곧 정지 위치(90)이기 때문. 시리얼 모니터 수동 테스트 편의상 둘 다 남겨둔다.
  if (input.equalsIgnoreCase("c") || input.equalsIgnoreCase("s")) {
    stopCurtain();
    Serial.print(F("커튼 정지 -> 각도: "));
    Serial.print(extraAngle);
    Serial.println(F(" | 계속 입력하거나 'm'으로 메뉴 복귀"));
    return;
  }
  if (input.equalsIgnoreCase("o")) {
    extraAngle = CURTAIN_OPEN_SPEED;
    writeExtraServo();
    curtainStartedMs = millis();
    Serial.println(F("커튼 열기 시작 | s=정지 m=메뉴복귀"));
    return;
  }
  if (input.equalsIgnoreCase("k")) {
    extraAngle = CURTAIN_CLOSE_SPEED;
    writeExtraServo();
    curtainStartedMs = millis();
    Serial.println(F("커튼 닫기 시작 | s=정지 m=메뉴복귀"));
    return;
  }

  int angle = input.toInt();
  if (angle < 0 || angle > 180) {
    Serial.println(F("o=열기 k=닫기 s=정지, 또는 0~180 속도값을 직접 입력하세요. (90=정지)"));
    return;
  }

  // 수동으로 속도값을 직접 넣는 경우도 정지(90)가 아니면 안전 타이머를 켠다.
  extraAngle = angle;
  writeExtraServo();
  curtainStartedMs = (angle == EXTRA_HOME_ANGLE) ? 0 : millis();
  Serial.print(F("서보모터 이동 완료 -> 각도: "));
  Serial.print(extraAngle);
  Serial.println(F(" | 계속 입력하거나 'm'으로 메뉴 복귀"));
}

void applyCamera(String rawInput) {
  String input = rawInput;
  input.trim();

  if (checkReturnToMenu(input)) return;
  if (input.length() == 0) return;

  char c = tolower(input.charAt(0));

  if (c == 'c') {
    stopCameraMotion();
    panAngle = PAN_HOME_ANGLE;
    tiltAngle = TILT_HOME_ANGLE;
    panPosition = panAngle;
    tiltPosition = tiltAngle;
    writeCameraServos();
    Serial.println(F("[중앙 복귀] Pan/Tilt | 계속 입력하거나 'm'으로 메뉴 복귀"));
    return;
  }

  // 문자 뒤에 공백+숫자가 있으면(예: "w 12") 그 값을 이번 이동의 스텝 크기로 쓰고,
  // 없으면 기존과 동일하게 기본 STEP_SIZE(45도)를 쓴다 — 시리얼 모니터에 수동으로
  // 문자만 입력해도 기존 그대로 동작.
  int stepSize = STEP_SIZE;
  int spaceIndex = input.indexOf(' ');
  if (spaceIndex != -1) {
    int parsedStep = input.substring(spaceIndex + 1).toInt();
    if (parsedStep > 0) stepSize = constrain(parsedStep, 1, 180);
  }

  if (!moveCameraOnce(c, stepSize)) return;

  writeCameraServos();

  Serial.print(F("카메라 이동 -> Pan: "));
  Serial.print(panAngle);
  Serial.print(F("  Tilt: "));
  Serial.print(tiltAngle);
  Serial.println(F(" | 계속 입력하거나 'm'으로 메뉴 복귀"));
}

void handleMenuSelection(String input) {
  input.trim();

  int choice = input.toInt();

  switch (choice) {
    case 1:
      currentMode = MODE_CAMERA;
      Serial.println(F("[카메라 제어 모드] w=위 s=아래 a=왼쪽 d=오른쪽 c=중앙복귀 m=메뉴복귀"));
      break;
    case 2:
      currentMode = MODE_SERVO;
      Serial.println(F("[커튼 제어 모드] o=열기 k=닫기 s=정지 c=중앙복귀 m=메뉴복귀 (숫자 입력 시 그 각도로 즉시 이동)"));
      break;
    case 3:
      currentMode = MODE_LIGHT;
      Serial.println(F("[조명 제어 모드] 0~10 숫자 입력 (0=끔, 10=최대), m=메뉴복귀"));
      break;
    case 4:
      currentMode = MODE_FAN;
      Serial.println(F("[선풍기 제어 모드] 0~10 숫자 입력 (0=정지, 10=최대), m=메뉴복귀"));
      break;
    default:
      Serial.println(F("1~4 중 하나를 입력하세요."));
      break;
  }
}

void setup() {
  Serial.begin(9600);

  pinMode(LIGHT_PIN, OUTPUT);
  pinMode(FAN_PIN, OUTPUT);
  analogWrite(LIGHT_PIN, 0);
  analogWrite(FAN_PIN, 0);

  extraServo.attach(EXTRA_SERVO_PIN);
  panServo.attach(CAM_PAN_PIN);
  tiltServo.attach(CAM_TILT_PIN);

  extraServo.write(EXTRA_HOME_ANGLE);
  panServo.write(PAN_HOME_ANGLE);
  tiltServo.write(TILT_HOME_ANGLE);

  delay(200);
  lastMotionTickMs = millis();
  printMenu();
}

void processSerialLine(char* line) {
  if (handleMotionProtocol(line)) return;
  String input(line);
  switch (currentMode) {
    case MODE_MENU:
      handleMenuSelection(input);
      break;
    case MODE_CAMERA:
      applyCamera(input);
      break;
    case MODE_SERVO:
      applyExtraServo(input);
      break;
    case MODE_LIGHT:
      applyLight(input);
      break;
    case MODE_FAN:
      applyFan(input);
      break;
  }
}

void readSerialLines() {
  while (Serial.available() > 0) {
    char incoming = Serial.read();
    if (incoming == '\r') continue;
    if (incoming == '\n') {
      if (serialOverflow) {
        serialOverflow = false;
        serialLength = 0;
        continue;
      }
      if (serialLength > 0) {
        serialBuffer[serialLength] = '\0';
        processSerialLine(serialBuffer);
        serialLength = 0;
      }
      continue;
    }
    if (serialOverflow) continue;
    if (serialLength < SERIAL_BUFFER_SIZE - 1) {
      serialBuffer[serialLength++] = incoming;
    } else {
      serialLength = 0;
      serialOverflow = true;
      sendMotionError(0, "LINE_TOO_LONG");
    }
  }
}

void loop() {
  updateCameraMotion();
  updateCurtainSafety();
  readSerialLines();
}
