"""Tests for M1: Timing data enrichment.

Every non-stub plant must have:
  - timing{} block with DTM, frost tolerance, soil temp, start method
  - family field (botanical family for crop rotation)

Every zone in zones.json must have frost dates and growing season length.
"""
import json
import pathlib
import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLANTS = json.loads((ROOT / "data" / "plants.json").read_text())
FULL_PLANTS = [p for p in PLANTS if not p.get("stub")]

ZONES_PATH = ROOT / "data" / "zones.json"

VALID_FROST_TOLERANCES = {"none", "light", "moderate", "hard"}
VALID_FAMILIES = {
    "solanaceae", "cucurbitaceae", "brassicaceae", "apiaceae",
    "fabaceae", "poaceae", "asteraceae", "lamiaceae", "amaryllidaceae",
    "chenopodiaceae", "amaranthaceae", "convolvulaceae", "malvaceae",
}


# ── Plant timing tests ──────────────────────────────────────

class TestTimingPresence:
    """Every full plant must have a timing block."""

    def test_all_full_plants_have_timing(self):
        missing = [p["id"] for p in FULL_PLANTS if "timing" not in p]
        assert missing == [], f"Plants missing timing: {missing}"

    def test_full_plant_count(self):
        assert len(FULL_PLANTS) == 38


class TestTimingFields:
    """Each timing block must have required fields with valid values."""

    @pytest.fixture(params=[p["id"] for p in FULL_PLANTS])
    def plant(self, request):
        return next(p for p in FULL_PLANTS if p["id"] == request.param)

    def test_days_to_maturity_is_range(self, plant):
        dtm = plant.get("timing", {}).get("days_to_maturity")
        assert dtm is not None, f"{plant['id']}: missing days_to_maturity"
        assert isinstance(dtm, list) and len(dtm) == 2, \
            f"{plant['id']}: days_to_maturity must be [min, max]"
        assert dtm[0] > 0 and dtm[1] >= dtm[0], \
            f"{plant['id']}: invalid DTM range {dtm}"

    def test_frost_tolerance_valid(self, plant):
        ft = plant.get("timing", {}).get("frost_tolerance")
        assert ft is not None, f"{plant['id']}: missing frost_tolerance"
        assert ft in VALID_FROST_TOLERANCES, \
            f"{plant['id']}: invalid frost_tolerance '{ft}'"

    def test_min_soil_temp(self, plant):
        mst = plant.get("timing", {}).get("min_soil_temp_f")
        assert mst is not None, f"{plant['id']}: missing min_soil_temp_f"
        assert isinstance(mst, (int, float)) and 30 <= mst <= 85, \
            f"{plant['id']}: soil temp {mst} out of range"

    def test_start_method(self, plant):
        t = plant.get("timing", {})
        ds = t.get("direct_sow")
        tp = t.get("transplant")
        assert ds is not None, f"{plant['id']}: missing direct_sow"
        assert tp is not None, f"{plant['id']}: missing transplant"
        assert ds or tp, f"{plant['id']}: must support direct_sow or transplant"

    def test_indoor_start_if_transplantable(self, plant):
        t = plant.get("timing", {})
        if t.get("transplant"):
            isw = t.get("indoor_start_weeks_before_frost")
            assert isw is not None, \
                f"{plant['id']}: transplantable but no indoor_start_weeks"
            assert isinstance(isw, (int, float)) and isw > 0, \
                f"{plant['id']}: invalid indoor_start_weeks {isw}"

    def test_days_to_germination(self, plant):
        dtg = plant.get("timing", {}).get("days_to_germination")
        assert dtg is not None, f"{plant['id']}: missing days_to_germination"
        assert isinstance(dtg, list) and len(dtg) == 2, \
            f"{plant['id']}: days_to_germination must be [min, max]"
        assert dtg[0] > 0 and dtg[1] >= dtg[0], \
            f"{plant['id']}: invalid germination range {dtg}"


# ── Family tests ─────────────────────────────────────────────

class TestFamily:
    """Every full plant must have a botanical family."""

    def test_all_full_plants_have_family(self):
        missing = [p["id"] for p in FULL_PLANTS if "family" not in p]
        assert missing == [], f"Plants missing family: {missing}"

    @pytest.fixture(params=[p["id"] for p in FULL_PLANTS])
    def plant(self, request):
        return next(p for p in FULL_PLANTS if p["id"] == request.param)

    def test_family_is_known(self, plant):
        fam = plant.get("family")
        assert fam in VALID_FAMILIES, \
            f"{plant['id']}: unknown family '{fam}'"


# ── Zone tests ───────────────────────────────────────────────

class TestZones:
    """zones.json must exist with valid frost date data."""

    def test_zones_file_exists(self):
        assert ZONES_PATH.exists(), "data/zones.json not found"

    @pytest.fixture
    def zones(self):
        return json.loads(ZONES_PATH.read_text())

    def test_at_least_10_zones(self, zones):
        assert len(zones) >= 10, f"Only {len(zones)} zones, expected ≥ 10"

    def test_zone_has_required_fields(self, zones):
        for zone_id, data in zones.items():
            assert "last_frost_avg" in data, f"{zone_id}: missing last_frost_avg"
            assert "first_frost_avg" in data, f"{zone_id}: missing first_frost_avg"
            assert "growing_season_days" in data, f"{zone_id}: missing growing_season_days"

    def test_zone_frost_dates_format(self, zones):
        import re
        for zone_id, data in zones.items():
            for field in ("last_frost_avg", "first_frost_avg"):
                val = data[field]
                assert re.match(r"^\d{2}-\d{2}$", val), \
                    f"{zone_id}.{field}: expected MM-DD format, got '{val}'"

    def test_growing_season_positive(self, zones):
        for zone_id, data in zones.items():
            gsd = data["growing_season_days"]
            assert isinstance(gsd, int) and gsd > 60, \
                f"{zone_id}: growing_season_days={gsd} seems wrong"

    def test_growing_season_increases_with_zone(self, zones):
        """Higher zones should generally have longer growing seasons."""
        def zone_sort_key(z):
            num = z.rstrip('ab')
            sub = z[-1] if z[-1] in 'ab' else 'a'
            return (int(num), sub)

        sorted_zones = sorted(zones.items(), key=lambda x: zone_sort_key(x[0]))
        seasons = [v["growing_season_days"] for _, v in sorted_zones]
        assert seasons[-1] > seasons[0], \
            "Growing season should increase from cold to warm zones"
