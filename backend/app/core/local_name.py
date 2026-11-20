"""Announce the server on the home network as <name>.local, the way Home Assistant is homeassistant.local.

Devices look up `.local` names with multicast DNS (mDNS): they ask the whole network "who is
mission-control.local?" and this answers with the PC's address. No router or DNS setup is needed. The address
is re-checked every minute, so a new DHCP address is picked up without a restart.

Only one word before `.local`: names like `a.b.local` aren't resolved by every device.
"""
import logging
import re
import socket
import threading
from collections.abc import Callable

log = logging.getLogger(__name__)

NAME_RE = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")
SERVICE_TYPE = "_http._tcp.local."


def check_name(name: str) -> str:
    """'Mission-Control.local' -> 'mission-control'. One DNS label: letters, digits and inner hyphens."""
    label = name.strip().lower().removesuffix(".").removesuffix(".local")
    if not NAME_RE.fullmatch(label):
        raise ValueError(f'"{name}" isn\'t a usable local name: use letters, digits and hyphens, e.g. mission-control')
    return label


def lan_ip() -> str | None:
    """This PC's address on the home network: the one its default route uses (nothing is actually sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))  # TEST-NET-1: never routed anywhere, just picks the outgoing interface
        ip = s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()
    return None if ip.startswith(("127.", "0.")) else ip


class LocalName:
    """Answers mDNS lookups for <name>.local with this PC's address, from a background thread."""

    def __init__(self, name: str, port: int, find_ip: Callable[[], str | None] = lan_ip,
                 zeroconf_factory: Callable | None = None, recheck_seconds: float = 60):
        self.name = check_name(name)
        self.port = port
        self._find_ip = find_ip
        self._factory = zeroconf_factory
        self._recheck = recheck_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._zc = None
        self._info = None
        self.ip: str | None = None

    @property
    def url(self) -> str:
        return f"http://{self.name}.local:{self.port}"

    def start(self) -> None:
        """Announce from a background thread. Zeroconf's blocking calls must stay off the app's event loop."""
        self._thread = threading.Thread(target=self._run, name="local-name", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=10)
        else:
            self._withdraw()

    def _run(self) -> None:
        self.refresh()
        while not self._stop.wait(self._recheck):
            self.refresh()
        try:
            self._withdraw()
        except Exception:
            log.exception("Couldn't withdraw %s.local", self.name)

    def refresh(self) -> None:
        """(Re)announce if the address changed. Never raises: the app runs fine without its local name."""
        try:
            ip = self._find_ip()
            if ip == self.ip:
                return
            self._withdraw()
            if ip:
                self._announce(ip)
            else:
                log.warning("No network address found; %s.local isn't being announced", self.name)
        except Exception:
            log.exception("Couldn't announce %s.local", self.name)

    def _announce(self, ip: str) -> None:
        from zeroconf import ServiceInfo, Zeroconf  # imported here so tests and dev runs don't need it loaded

        factory = self._factory or Zeroconf
        info = ServiceInfo(
            SERVICE_TYPE,
            f"Mission Control ({self.name}).{SERVICE_TYPE}",
            addresses=[socket.inet_aton(ip)],
            port=self.port,
            server=f"{self.name}.local.",
            properties={"path": "/"},
        )
        zc = factory(interfaces=[ip])
        zc.register_service(info, allow_name_change=True)
        self._zc, self._info, self.ip = zc, info, ip
        log.info("Announcing %s on the home network (%s)", self.url, ip)

    def _withdraw(self) -> None:
        zc, info = self._zc, self._info
        self._zc = self._info = self.ip = None
        if zc is None:
            return
        try:
            if info is not None:
                zc.unregister_service(info)
        finally:
            zc.close()
