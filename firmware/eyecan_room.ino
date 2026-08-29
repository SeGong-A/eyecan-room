#include <Servo.h>

// Pin assignments for Arduino Uno — see PINS.md for the full table and rationale.
// D0/D1 are reserved for Serial (command in / ACK out) and must never be reused here.
Servo panServo;
Servo tiltServo;

const int panPin = 9;           // Servo (Timer1)
const int tiltPin = 10;         // Servo (Timer1)
const int fanPin = 5;           // PWM analogWrite (Timer0)
const int lightPin = 6;         // PWM analogWrite (Timer0)
const int curtainOpenPin = 7;   // Digital out — motor driver direction
const int curtainClosePin = 8;  // Digital out — motor driver direction

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

void stopCurtain() {
  digitalWrite(curtainOpenPin, LOW);
  digitalWrite(curtainClosePin, LOW);
}

void openCurtain() {
  digitalWrite(curtainOpenPin, HIGH);
  digitalWrite(curtainClosePin, LOW);
}

void closeCurtain() {
  digitalWrite(curtainOpenPin, LOW);
  digitalWrite(curtainClosePin, HIGH);
}

String readSerialCommand() {
  String command = Serial.readStringUntil('\n');
  command.trim();
  return command;
}

void sendAck(const String &command) {
  Serial.print("ACK:");
  Serial.println(command);
}

bool handleCameraCommand(const String &command) {
  if (command == "CAM_LEFT") {
    applyCameraPosition(40, tiltAngle);
    return true;
  }
  if (command == "CAM_RIGHT") {
    applyCameraPosition(140, tiltAngle);
    return true;
  }
  if (command == "CAM_UP") {
    applyCameraPosition(panAngle, 60);
    return true;
  }
  if (command == "CAM_DOWN") {
    applyCameraPosition(panAngle, 120);
    return true;
  }
  if (command == "CAM_STOP") {
    applyCameraPosition(90, 90);
    return true;
  }
  return false;
}

bool handleFanCommand(const String &command) {
  if (command == "FAN_ON") {
    applyFanLevel(180);
    return true;
  }
  if (command == "FAN_OFF") {
    applyFanLevel(0);
    return true;
  }
  if (command == "FAN_LOW") {
    applyFanLevel(80);
    return true;
  }
  if (command == "FAN_MID") {
    applyFanLevel(160);
    return true;
  }
  if (command == "FAN_HIGH") {
    applyFanLevel(255);
    return true;
  }
  return false;
}

bool handleLightCommand(const String &command) {
  if (command == "LIGHT_ON") {
    applyLightLevel(255);
    return true;
  }
  if (command == "LIGHT_OFF") {
    applyLightLevel(0);
    return true;
  }
  if (command == "LIGHT_UP") {
    applyLightLevel(255);
    return true;
  }
  if (command == "LIGHT_DOWN") {
    applyLightLevel(80);
    return true;
  }
  return false;
}

bool handleCurtainCommand(const String &command) {
  if (command == "CURTAIN_OPEN") {
    openCurtain();
    return true;
  }
  if (command == "CURTAIN_CLOSE") {
    closeCurtain();
    return true;
  }
  if (command == "CURTAIN_STOP") {
    stopCurtain();
    return true;
  }
  return false;
}

bool handleWindowCommand(const String &command) {
  return command == "WINDOW_OPEN" || command == "WINDOW_CLOSE" || command == "WINDOW_STOP";
}

bool handleTvCommand(const String &command) {
  return command == "TV_POWER" || command == "TV_CH_UP" || command == "TV_CH_DOWN" || command == "TV_VOL_UP" || command == "TV_VOL_DOWN";
}

void handleCommand(const String &command) {
  if (
    handleCameraCommand(command) ||
    handleFanCommand(command) ||
    handleLightCommand(command) ||
    handleCurtainCommand(command) ||
    handleWindowCommand(command) ||
    handleTvCommand(command)
  ) {
    sendAck(command);
    return;
  }

  sendAck(command);
}

void setup() {
  Serial.begin(115200);
  panServo.attach(panPin);
  tiltServo.attach(tiltPin);
  pinMode(fanPin, OUTPUT);
  pinMode(lightPin, OUTPUT);
  pinMode(curtainOpenPin, OUTPUT);
  pinMode(curtainClosePin, OUTPUT);
  applyCameraPosition(90, 90);
  applyFanLevel(0);
  applyLightLevel(0);
  stopCurtain();
}

void loop() {
  if (!Serial.available()) {
    return;
  }

  String command = readSerialCommand();

  if (command.length() == 0) {
    return;
  }

  handleCommand(command);
}
