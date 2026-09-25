#include <BleKeyboard.h>

BleKeyboard bleKeyboard("EyeCan iPad Control", "EyeCan Room", 100);

void setup() {
  Serial.begin(115200);
  bleKeyboard.begin();
  Serial.println("READY");
}

void loop() {
  static bool lastConnected = false;
  bool connected = bleKeyboard.isConnected();
  if (connected != lastConnected) {
    Serial.println(connected ? "BLE_CONNECTED" : "BLE_DISCONNECTED");
    lastConnected = connected;
  }
  if (!Serial.available()) {
    delay(10);
    return;
  }
  String line = Serial.readStringUntil('\n');
  line.trim();
  int separator = line.indexOf(' ');
  String command = separator < 0 ? line : line.substring(0, separator);
  String commandId = separator < 0 ? "0" : line.substring(separator + 1);
  if (!connected) {
    Serial.println("ERR " + commandId + " BLE_NOT_CONNECTED");
    return;
  }
  if (command == "VOL_UP") {
    bleKeyboard.write(KEY_MEDIA_VOLUME_UP);
  } else if (command == "VOL_DOWN") {
    bleKeyboard.write(KEY_MEDIA_VOLUME_DOWN);
  } else {
    Serial.println("ERR " + commandId + " UNKNOWN_COMMAND");
    return;
  }
  Serial.println("ACK " + commandId + " " + command);
}
