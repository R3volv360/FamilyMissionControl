"""Announcing the server as <name>.local (mDNS). Zeroconf is replaced by a fake: tests never touch the network."""
import pytest
from fastapi.testclient import TestClient

from app.core.local_name import LocalName, check_name
from app.main import create_app


class FakeZeroconf:
    made: list["FakeZeroconf"] = []

    def __init__(self, interfaces):
        self.interfaces = interfaces
        self.registered, self.closed = [], False
        FakeZeroconf.made.append(self)

    def register_service(self, info, allow_name_change=False):
        self.registered.append(info)

    def unregister_service(self, info):
        self.registered.remove(info)

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def reset():
    FakeZeroconf.made = []


@pytest.mark.parametrize("raw,name", [("mission-control", "mission-control"), ("Kitchen.local", "kitchen"),
                                      (" mc ", "mc"), ("mc.local.", "mc")])
def test_check_name(raw, name):
    assert check_name(raw) == name


@pytest.mark.parametrize("bad", ["", "mission control", "a.b", "-mc", "mc-", "kitchen.home.local"])
def test_check_name_rejects(bad):
    with pytest.raises(ValueError):
        check_name(bad)


def test_announces_name_and_address():
    ann = LocalName("mission-control", 5683, find_ip=lambda: "192.168.0.67", zeroconf_factory=FakeZeroconf)
    ann.refresh()
    zc = FakeZeroconf.made[0]
    assert zc.interfaces == ["192.168.0.67"]
    [info] = zc.registered
    assert info.server == "mission-control.local."
    assert info.port == 5683
    assert info.parsed_addresses() == ["192.168.0.67"]
    assert ann.url == "http://mission-control.local:5683"
    ann.stop()
    assert zc.registered == [] and zc.closed


def test_follows_a_new_address():
    ips = iter(["192.168.0.67", "192.168.0.67", "192.168.0.80", None])
    ann = LocalName("mc", 5683, find_ip=lambda: next(ips), zeroconf_factory=FakeZeroconf)
    ann.refresh()
    ann.refresh()  # same address: nothing changes
    assert len(FakeZeroconf.made) == 1
    ann.refresh()  # new address: old announcement withdrawn, new one made
    assert FakeZeroconf.made[0].closed
    assert FakeZeroconf.made[1].registered[0].parsed_addresses() == ["192.168.0.80"]
    ann.refresh()  # no network: withdrawn, no error
    assert FakeZeroconf.made[1].closed and ann.ip is None


def test_failure_never_stops_the_app():
    def boom(interfaces):
        raise OSError("no multicast here")

    ann = LocalName("mc", 5683, find_ip=lambda: "192.168.0.67", zeroconf_factory=boom)
    ann.refresh()  # logged, not raised
    assert ann.ip is None


def test_app_announces_only_when_configured(settings, monkeypatch):
    started = []
    monkeypatch.setattr("app.main.LocalName.start", lambda self: started.append(self.name))
    monkeypatch.setattr("app.main.LocalName.stop", lambda self: None)
    with TestClient(create_app(settings)):
        pass
    assert started == []
    settings.local_name = "mission-control"
    with TestClient(create_app(settings)):
        pass
    assert started == ["mission-control"]


def test_start_and_stop_run_in_the_background():
    ann = LocalName("mc", 5683, find_ip=lambda: "192.168.0.67", zeroconf_factory=FakeZeroconf, recheck_seconds=0.01)
    ann.start()
    ann.stop()
    [zc] = FakeZeroconf.made
    assert zc.closed and zc.registered == []
