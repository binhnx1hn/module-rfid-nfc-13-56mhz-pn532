import time
import board
import busio
from digitalio import DigitalInOut
from adafruit_pn532.spi import PN532_SPI

print("Khoi tao SPI...")

cs_pin = DigitalInOut(board.D5)
spi = busio.SPI(board.SCK, MOSI=board.MOSI, MISO=board.MISO)

pn532 = PN532_SPI(spi, cs_pin, debug=False)

print("Dang doc firmware PN532...")
ic, ver, rev, support = pn532.firmware_version
print(f"Found PN532 firmware {ver}.{rev}")

pn532.SAM_configuration()

print("Waiting for card...")
while True:
    uid = pn532.read_passive_target(timeout=0.5)
    if uid is not None:
        print("UID:", [hex(x) for x in uid])
        time.sleep(1)
