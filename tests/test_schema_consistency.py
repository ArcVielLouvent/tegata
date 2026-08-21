"""
Cross-language schema consistency check.

This test does NOT re-derive types from tegata.schema.json automatically
(that would need a codegen step we don't have time to build for the
hackathon). Instead, it hand-encodes the same enum values and required
fields the JSON schema declares, and checks the Python Pydantic models
agree with them. The equivalent enum/field list is duplicated in
tests/schema_consistency.test.ts for the TypeScript side.

If you add/rename a field or enum value in tegata.schema.json, you MUST
update this file, its TS counterpart, and both models.py / schema.ts, or
this test will fail on purpose.
"""
import json
from pathlib import Path

import pytest

SCHEMA_PATH = (
    Path(__file__).resolve().parents[1] / "packages" / "schema" / "tegata.schema.json"
)


@pytest.fixture(scope="module")
def json_schema():
    with open(SCHEMA_PATH) as f:
        return json.load(f)


def test_risk_tier_enum_matches(json_schema):
    from models import RiskTier

    expected = set(json_schema["definitions"]["RiskTier"]["enum"])
    actual = {t.value for t in RiskTier}
    assert actual == expected, f"RiskTier mismatch: schema={expected} python={actual}"


def test_warrant_status_enum_matches(json_schema):
    from models import WarrantStatus

    expected = set(json_schema["definitions"]["WarrantStatus"]["enum"])
    actual = {s.value for s in WarrantStatus}
    assert actual == expected, f"WarrantStatus mismatch: schema={expected} python={actual}"


def test_access_request_required_fields_match(json_schema):
    from models import AccessRequest

    expected_required = set(json_schema["definitions"]["AccessRequest"]["required"])
    python_required = {
        name
        for name, field in AccessRequest.model_fields.items()
        if field.is_required()
    }
    assert python_required == expected_required, (
        f"AccessRequest required-field mismatch: "
        f"schema={expected_required} python={python_required}"
    )


def test_warrant_required_fields_match(json_schema):
    from models import Warrant

    expected_required = set(json_schema["definitions"]["Warrant"]["required"])
    python_required = {
        name for name, field in Warrant.model_fields.items() if field.is_required()
    }
    assert python_required == expected_required, (
        f"Warrant required-field mismatch: "
        f"schema={expected_required} python={python_required}"
    )
