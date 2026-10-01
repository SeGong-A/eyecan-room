/*
  선풍기 디지털 온오프 테스트 (진단용, 평소 사용하는 스케치 아님)

  목적: analogWrite(PWM) 대신 digitalWrite로 D11을 3초마다 HIGH/LOW 켜고 끄면서
        선풍기가 반응하는지 확인한다. PWM 주파수/듀티비 문제 가능성까지 배제하고
        "이 핀에 뭐라도 신호를 주면 팬이 도는가"만 순수하게 본다.
*/

const int fanPin = 11;

void setup() {
  pinMode(fanPin, OUTPUT);
}

void loop() {
  digitalWrite(fanPin, HIGH);
  delay(3000);
  digitalWrite(fanPin, LOW);
  delay(3000);
}
