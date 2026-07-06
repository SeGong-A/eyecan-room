#include <Servo.h>

Servo panServo;
Servo tiltServo;

const int panPin = 9;
const int tiltPin = 10;
const int fanPin = 5;
const int lightPin = 6;

int panAngle = 90;
int tiltAngle = 90;

void applyCameraPosition(int pan, int tilt) {
  panAngle = constrain(pan, 0, 180);
  tiltAngle = constrain(tilt, 0, 180);
  panServo.write(panAngle);
  tiltServo.write(tiltAngle);
}

void applyFanLevel(int value) {
  analogWrite(fanPin, constrain(value, 0, 255));
}

void applyLightLevel(int value) {
  analogWrite(lightPin, constrain(value, 0, 255));
}

void handleCommand(const String &command) {
  if (command == "CAM_LEFT") {
    applyCameraPosition(40, tiltAngle);
  } else if (command == "CAM_RIGHT") {
    applyCameraPosition(140, tiltAngle);
  } else if (command == "CAM_UP") {
    applyCameraPosition(panAngle, 60);
  } else if (command == "CAM_DOWN") {
    applyCameraPosition(panAngle, 120);
  } else if (command == "CAM_STOP") {
    applyCameraPosition(90, 90);
  } else if (command == "FAN_ON") {
    applyFanLevel(180);
  } else if (command == "FAN_OFF") {
    applyFanLevel(0);
  } else if (command == "FAN_LOW") {
    applyFanLevel(80);
  } else if (command == "FAN_MID") {
    applyFanLevel(160);
  } else if (command == "FAN_HIGH") {
    applyFanLevel(255);
  } else if (command == "LIGHT_ON") {
    applyLightLevel(255);
  } else if (command == "LIGHT_OFF") {
    applyLightLevel(0);
  } else if (command == "LIGHT_UP") {
    applyLightLevel(255);
  } else if (command == "LIGHT_DOWN") {
    applyLightLevel(80);
  }

  Serial.print("ACK:");
  Serial.println(command);
}

void setup() {
  Serial.begin(115200);
  panServo.attach(panPin);
  tiltServo.attach(tiltPin);
  pinMode(fanPin, OUTPUT);
  pinMode(lightPin, OUTPUT);
  applyCameraPosition(90, 90);
  applyFanLevel(0);
  applyLightLevel(0);
}

void loop() {
  if (!Serial.available()) {
    return;
  }

  String command = Serial.readStringUntil('\n');
  command.trim();

  if (command.length() == 0) {
    return;
  }

  handleCommand(command);
}
