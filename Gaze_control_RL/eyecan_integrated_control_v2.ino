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

const int STEP_SIZE = 10;
const int HOME_ANGLE = 90;

Servo extraServo;
Servo panServo;
Servo tiltServo;

int lightLevel = 0;
int fanLevel = 0;
int extraAngle = HOME_ANGLE;
int panAngle = HOME_ANGLE;
int tiltAngle = HOME_ANGLE;

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
  if (input.equalsIgnoreCase("m")) {
    backToMenu();
    return true;
  }
  return false;
}

void applyLight(String rawInput) {
  if (checkReturnToMenu(rawInput)) return;

  int level = rawInput.toInt();
  if (level < 0 || level > 10) {
    Serial.println("잘못된 입력입니다. 0~10 숫자를 입력하거나, 'm'으로 메뉴 복귀하세요.");
    return;
  }

  lightLevel = level;
  int pwmValue = map(level, 0, 10, 0, 255);
  analogWrite(LIGHT_PIN, pwmValue);

  Serial.print("조명 밝기 변경 -> Level ");
  Serial.print(level);
  Serial.print(" (PWM 값: ");
  Serial.print(pwmValue);
  Serial.println(") | 계속 입력하거나 'm'으로 메뉴 복귀");
}

void applyFan(String rawInput) {
  if (checkReturnToMenu(rawInput)) return;

  int level = rawInput.toInt();
  if (level < 0 || level > 10) {
    Serial.println("잘못된 입력입니다. 0~10 숫자를 입력하거나, 'm'으로 메뉴 복귀하세요.");
    return;
  }

  fanLevel = level;
  int pwmValue = (level == 0) ? 0 : map(level, 1, 10, 255, 40);
  analogWrite(FAN_PIN, pwmValue);

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
    extraAngle = HOME_ANGLE;
    extraServo.write(extraAngle);
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
  extraServo.write(extraAngle);
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

  switch (c) {
    case 'w':
      tiltAngle = constrain(tiltAngle + STEP_SIZE, 0, 180);
      break;
    case 's':
      tiltAngle = constrain(tiltAngle - STEP_SIZE, 0, 180);
      break;
    case 'a':
      panAngle = constrain(panAngle - STEP_SIZE, 0, 180);
      break;
    case 'd':
      panAngle = constrain(panAngle + STEP_SIZE, 0, 180);
      break;
    case 'c':
      panAngle = HOME_ANGLE;
      tiltAngle = HOME_ANGLE;
      panServo.write(panAngle);
      tiltServo.write(tiltAngle);
      Serial.println("[중앙 복귀] Pan/Tilt | 계속 입력하거나 'm'으로 메뉴 복귀");
      return;
    default:
      Serial.println("w(위)/a(왼쪽)/s(아래)/d(오른쪽)/c(중앙복귀)/m(메뉴복귀) 중 입력하세요.");
      return;
  }

  panServo.write(panAngle);
  tiltServo.write(tiltAngle);

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

  extraServo.write(HOME_ANGLE);
  panServo.write(HOME_ANGLE);
  tiltServo.write(HOME_ANGLE);

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
