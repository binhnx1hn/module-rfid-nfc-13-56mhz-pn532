"""
pn532_reader.py — PN532 SPI hardware layer for PN532 Card Reader System.

Wraps adafruit_pn532 SPI driver with debounce logic to prevent duplicate
card reads within a 2-second window. Uses same pin config as test_pn532_spi.py.
"""

import time
import board
import busio
from digitalio import DigitalInOut
from adafruit_pn532.spi import PN532_SPI

DEBOUNCE_SECONDS = 10.0


class PN532Reader:
    """Hardware wrapper for PN532 NFC/RFID reader via SPI.

    Initialises the PN532 on SPI bus (CS=D5), prints firmware version,
    configures SAM, and exposes read_uid() with 2-second debounce.
    """

    def __init__(self) -> None:
        """Initialise SPI bus, PN532, and SAM configuration."""
        cs_pin = DigitalInOut(board.D5)
        spi = busio.SPI(board.SCK, MOSI=board.MOSI, MISO=board.MISO)
        self._pn532 = PN532_SPI(spi, cs_pin, debug=False)

        ic, ver, rev, support = self._pn532.firmware_version
        print(f"[PN532Reader] Firmware version: {ver}.{rev} (IC={ic}, Support={support})")

        self._pn532.SAM_configuration()
        print("[PN532Reader] SAM configured. Ready to read cards.")

        self._last_uid: bytes | None = None
        self._last_time: float = 0.0

    def read_uid(self) -> bytes | None:
        """Poll for an NFC/RFID card and return its UID bytes, or None.

        Applies 2-second debounce: if the same card_id is detected within
        DEBOUNCE_SECONDS of the last read, returns None to skip the duplicate.

        Returns:
            bytes: UID of the detected card.
            None: No card present, or same card read within debounce window.
        """
        uid = self._pn532.read_passive_target(timeout=0.5)
        if uid is None:
            return None

        now = time.time()
        if uid == self._last_uid and (now - self._last_time) < DEBOUNCE_SECONDS:
            return None

        self._last_uid = uid
        self._last_time = now
        return uid
