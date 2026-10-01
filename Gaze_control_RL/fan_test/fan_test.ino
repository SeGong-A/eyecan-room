/*
  선풍기 동작 확인 전용 최소 테스트 스케치 (진단용, 평소 사용하는 스케치 아님)

  목적: eyecan_integrated_control_v2.ino의 메뉴/시리얼 프로토콜을 전부 걷어내고
        선풍기 핀(D6) PWM만 직접 켜서, 소프트웨어(명령 전달) 문제인지 하드웨어
        (배선/전원/모터드라이버/모터 자체) 문제인지 가른다.

  핀은 eyecan_integrated_control_v2.ino와 동일: 선풍기 -> 6번 핀

  사용법
    1) 업로드 후 시리얼 모니터(9600bps, Newline) 연다.
    2) 자동으로 0 -> 120(최소 구동 PWM) -> 180 -> 255(최대) 순으로 3초씩 돌며
       시리얼에 지금 PWM 값을 찍는다.
    3) 그 사이에 숫자(0~255)를 직접 입력해서 원하는 PWM 값으로 즉시 바꿔볼 수도 있다.

  판정 방법
    - 자동 사이클 중 어느 단계에서든 팬이 돈다        -> 배선/전원/모터 정상,
      메인 스케치 쪽(명령 경로) 문제로 좁혀짐
    - 255(최대)까지 줘도 전혀 안 돈다, 소리도 없다     -> 신호선(D6) 단선, 공통 GND
      누락, 또는 모터드라이버/모터 자체 전원 문제
    - 소리만 나고 날개가 안 돈다                       -> 전류 부족 또는 기계적 걸림
*/

const int FAN_PIN = 6;
const int FAN_MIN_PWM = 120; // eyecan_integrated_control_v2.ino와 동일 - 이보다 낮으면 이 팬은 아예 안 돌 수 있음

int pwmValue = 0;

void setFan(int value) {
  pwmValue = constrain(value, 0, 255);
  analogWrite(FAN_PIN, pwmValue);
  Serial.print(F("팬 PWM -> "));
  Serial.println(pwmValue);
}

void setup() {
  Serial.begin(9600);
  pinMode(FAN_PIN, OUTPUT);
  analogWrite(FAN_PIN, 0);

  Serial.println();
  Serial.println(F("=== 선풍기 단독 테스트 (D6) ==="));
  Serial.println(F("자동으로 0 -> 120 -> 180 -> 255 순서로 3초씩 돌립니다."));
  Serial.println(F("시리얼 모니터에 0~255 숫자를 입력하면 그 값으로 바로 바뀝니다."));
}

void loop() {
  static const int steps[] = { 0, FAN_MIN_PWM, 180, 255 };
  static const int stepCount = sizeof(steps) / sizeof(steps[0]);
  static int stepIndex = 0;
  static unsigned long stepStartedMs = 0;
  static bool manualOverride = false;

  if (Serial.available() > 0) {
    int value = Serial.parseInt();
    while (Serial.available() > 0) Serial.read(); // 남은 개행 등 비움
    manualOverride = true;
    setFan(value);
  }

  if (!manualOverride) {
    if (stepStartedMs == 0) {
      stepStartedMs = millis();
      setFan(steps[stepIndex]);
    }
    if (millis() - stepStartedMs >= 3000) {
      stepIndex = (stepIndex + 1) % stepCount;
      stepStartedMs = millis();
      setFan(steps[stepIndex]);
    }
  }
}
