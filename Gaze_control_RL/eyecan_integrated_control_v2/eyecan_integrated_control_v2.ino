/*
  EyeCan Room - 통합 장치 제어 코드 (아두이노 우노 1개)

  핀 배치
    조명(MOSFET PWM)     -> 3번 핀
    선풍기(Grove Mini Fan)-> 6번 핀 (주의: 우노는 3,5,6,9,10,11번만 PWM 지원. 4번은 PWM 불가)
    별도 서보모터         -> 5번 핀
    카메라 좌우(Pan) 서보  -> 8번 핀
    카메라 상하(Tilt) 서보 -> 9번 핀

  사용 방법
    1) 시리얼 모니터(9600bps, Newline)를 엽니다.
    2) 메뉴에서 숫자 1~4를 입력해 제어할 장치를 선택합니다.
       1 = 카메라(Pan/Tilt)
       2 = 서보모터
       3 = 조명
       4 = 선풍기
    3) 장치를 선택하면 그 장치 전용 명령을 계속 반복해서 입력할 수 있습니다.
       - 조명/선풍기: 0~10 숫자 (0=끔/정지, 10=최대) 를 원하는 만큼 계속 입력
       - 서보모터: 0~180 각도, 또는 c(중앙 복귀) 를 원하는 만큼 계속 입력
       - 카메라: w(위)/a(왼쪽)/s(아래)/d(오른쪽)/c(중앙 복귀) 를 원하는 만큼 계속 입력
    4) 다른 장치를 제어하고 싶으면 'm' 을 입력하면 메뉴로 돌아갑니다.
       (메뉴로 돌아가도 방금 설정한 상태는 그대로 유지됩니다)
*/

#include <Servo.h>

const int LIGHT_PIN = 3;
const int FAN_PIN = 6;
const int EXTRA_SERVO_PIN = 5;
const int CAM_PAN_PIN = 8;
const int CAM_TILT_PIN = 9;

const int STEP_SIZE = 45;
const int PAN_HOME_ANGLE = 90;
const int TILT_HOME_ANGLE = 20;
const int EXTRA_HOME_ANGLE = 90;

Servo extraServo;
Servo panServo;
Servo tiltServo;

int lightLevel = 0;
int fanLevel = 0;
int extraAngle = EXTRA_HOME_ANGLE;
int panAngle = PAN_HOME_ANGLE;
int tiltAngle = TILT_HOME_ANGLE;

enum Mode { MODE_MENU, MODE_CAMERA, MODE_SERVO, MODE_LIGHT, MODE_FAN };
Mode currentMode = MODE_MENU;

void printMenu() {
  Serial.println();
  Serial.println("========== EyeCan Room 통합 제어 메뉴 ==========");
  Serial.print("1) 카메라(Pan/Tilt)   현재 Pan: ");
  Serial.print(panAngle);
  Serial.print("  Tilt: ");
  Serial.println(tiltAngle);

  Serial.print("2) 서보모터           현재 각도: ");
  Serial.println(extraAngle);

  Serial.print("3) 조명               현재 단계: ");
  Serial.println(lightLevel);

  Serial.print("4) 선풍기             현재 단계: ");
  Serial.println(fanLevel);

  Serial.println("번호(1~4)를 입력해 제어할 장치를 선택하세요.");
  Serial.println("=================================================");
}

void backToMenu() {
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
  return (level == 0) ? 0 : map(level, 1, 10, 255, 40);
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

// 웹 UI가 시선이 화면 가장자리에 머무는 동안 같은 방향 명령을 계속 반복 전송해서
// 팬틸트를 상시 제어한다(apps/web/src/hooks/useGazePanTilt.ts). 그래서 방향당 1회로
// 제한하던 잠금은 없앴다 - 매번 stepSize만큼 누적 이동하고 0~180 범위로만 clamp한다.
// stepSize는 웹 UI가 시선이 중심에서 벗어난 정도에 비례해 넘겨주는 값이고(조이스틱형
// 제어), 시리얼 모니터에서 숫자 없이 문자만 입력하면 기본값 STEP_SIZE(45도)가 쓰인다.
bool moveCameraOnce(char direction, int stepSize) {
  switch (direction) {
    case 'w':
      tiltAngle = constrain(tiltAngle + stepSize, 0, 180);
      return true;
    case 's':
      tiltAngle = constrain(tiltAngle - stepSize, 0, 180);
      return true;
    case 'a':
      panAngle = constrain(panAngle - stepSize, 0, 180);
      return true;
    case 'd':
      panAngle = constrain(panAngle + stepSize, 0, 180);
      return true;
    default:
      Serial.println("w(위)/a(왼쪽)/s(아래)/d(오른쪽)/c(중앙복귀)/m(메뉴복귀) 중 입력하세요.");
      return false;
  }
}

void applyLight(String rawInput) {
  if (checkReturnToMenu(rawInput)) return;

  int level = rawInput.toInt();
  if (!isValidLevel(level)) {
    Serial.println("잘못된 입력입니다. 0~10 숫자를 입력하거나, 'm'으로 메뉴 복귀하세요.");
    return;
  }

  lightLevel = level;
  int pwmValue = levelToLightPwm(level);
  applyPwmLevel(LIGHT_PIN, pwmValue);

  Serial.print("조명 밝기 변경 -> Level ");
  Serial.print(level);
  Serial.print(" (PWM 값: ");
  Serial.print(pwmValue);
  Serial.println(") | 계속 입력하거나 'm'으로 메뉴 복귀");
}

void applyFan(String rawInput) {
  if (checkReturnToMenu(rawInput)) return;

  int level = rawInput.toInt();
  if (!isValidLevel(level)) {
    Serial.println("잘못된 입력입니다. 0~10 숫자를 입력하거나, 'm'으로 메뉴 복귀하세요.");
    return;
  }

  fanLevel = level;
  int pwmValue = levelToFanPwm(level);
  applyPwmLevel(FAN_PIN, pwmValue);

  Serial.print("선풍기 속도 변경 -> Level ");
  Serial.print(level);
  Serial.print(" (PWM 값: ");
  Serial.print(pwmValue);
  Serial.println(") | 계속 입력하거나 'm'으로 메뉴 복귀");
}

void applyExtraServo(String rawInput) {
  String input = rawInput;
  input.trim();

  if (checkReturnToMenu(input)) return;

  if (input.equalsIgnoreCase("c")) {
    extraAngle = EXTRA_HOME_ANGLE;
    writeExtraServo();
    Serial.print("[중앙 복귀] 각도: ");
    Serial.print(extraAngle);
    Serial.println(" | 계속 입력하거나 'm'으로 메뉴 복귀");
    return;
  }

  int angle = input.toInt();
  if (angle < 0 || angle > 180) {
    Serial.println("각도는 0~180 사이여야 합니다. (c=중앙복귀, m=메뉴복귀)");
    return;
  }

  extraAngle = angle;
  writeExtraServo();
  Serial.print("서보모터 이동 완료 -> 각도: ");
  Serial.print(extraAngle);
  Serial.println(" | 계속 입력하거나 'm'으로 메뉴 복귀");
}

void applyCamera(String rawInput) {
  String input = rawInput;
  input.trim();

  if (checkReturnToMenu(input)) return;
  if (input.length() == 0) return;

  char c = tolower(input.charAt(0));

  if (c == 'c') {
    panAngle = PAN_HOME_ANGLE;
    tiltAngle = TILT_HOME_ANGLE;
    writeCameraServos();
    Serial.println("[중앙 복귀] Pan/Tilt | 계속 입력하거나 'm'으로 메뉴 복귀");
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

  Serial.print("카메라 이동 -> Pan: ");
  Serial.print(panAngle);
  Serial.print("  Tilt: ");
  Serial.print(tiltAngle);
  Serial.println(" | 계속 입력하거나 'm'으로 메뉴 복귀");
}

void handleMenuSelection(String input) {
  input.trim();

  int choice = input.toInt();

  switch (choice) {
    case 1:
      currentMode = MODE_CAMERA;
      Serial.println("[카메라 제어 모드] w=위 s=아래 a=왼쪽 d=오른쪽 c=중앙복귀 m=메뉴복귀");
      break;
    case 2:
      currentMode = MODE_SERVO;
      Serial.println("[서보모터 제어 모드] 0~180 각도 입력, c=중앙복귀, m=메뉴복귀");
      break;
    case 3:
      currentMode = MODE_LIGHT;
      Serial.println("[조명 제어 모드] 0~10 숫자 입력 (0=끔, 10=최대), m=메뉴복귀");
      break;
    case 4:
      currentMode = MODE_FAN;
      Serial.println("[선풍기 제어 모드] 0~10 숫자 입력 (0=정지, 10=최대), m=메뉴복귀");
      break;
    default:
      Serial.println("1~4 중 하나를 입력하세요.");
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
  printMenu();
}

void loop() {
  if (Serial.available() > 0) {
    delay(30);

    String input = Serial.readStringUntil('\n');

    while (Serial.available() > 0) {
      Serial.read();
    }

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
}
