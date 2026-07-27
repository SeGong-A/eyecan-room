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
  } else if (command == "CURTAIN_OPEN") {
    openCurtain();
  } else if (command == "CURTAIN_CLOSE") {
    closeCurtain();
  } else if (command == "CURTAIN_STOP") {
    stopCurtain();
  } else if (command == "WINDOW_OPEN" || command == "WINDOW_CLOSE" || command == "WINDOW_STOP") {
    // Window motor pins and driver will be assigned after hardware selection.
  } else if (command == "TV_POWER" || command == "TV_CH_UP" || command == "TV_CH_DOWN" || command == "TV_VOL_UP" || command == "TV_VOL_DOWN") {
    // TV commands are handled by the web mock for the MVP.
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

  String command = Serial.readStringUntil('\n');
  command.trim();

  if (command.length() == 0) {
    return;
  }

  handleCommand(command);
}
