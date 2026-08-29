
#include <Servo.h>

Servo panServo;
Servo tiltServo;

int panAngle = 90;
int tiltAngle = 90;

void setup() {
  Serial.begin(115200);
  panServo.attach(9);   // Pan 서보모터 핀
  tiltServo.attach(10); // Tilt 서보모터 핀
  
  panServo.write(panAngle);
  tiltServo.write(tiltAngle);
}

void loop() {
  if (Serial.available() > 0) {
    String data = Serial.readStringUntil('\n');
    data.trim();
    
    // 무결성 검증: <pan_speed, tilt_speed> 형식
    if (data.startsWith("<") && data.endsWith(">")) {
      data = data.substring(1, data.length() - 1); // 괄호 제거
      
      int commaIdx = data.indexOf(',');
      if (commaIdx > 0) {
        String panStr = data.substring(0, commaIdx);
        String tiltStr = data.substring(commaIdx + 1);
        
        int panSpeed = panStr.toInt();
        int tiltSpeed = tiltStr.toInt();
        
        // 속도를 각도 변화량으로 누적 (적분기 역할)
        panAngle -= panSpeed; // 좌우 방향 매핑에 따라 += 또는 -= 선택
        tiltAngle += tiltSpeed;
        
        // 서보모터 가동 범위 클램핑 (Clamp)
        panAngle = constrain(panAngle, 0, 180);
        tiltAngle = constrain(tiltAngle, 0, 180);
        
        panServo.write(panAngle);
        tiltServo.write(tiltAngle);
      }
    }
  }
}
