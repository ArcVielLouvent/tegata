import base64
import json

import pytest
import responses as responses_lib

from tegata_agent.foxit_client import (
    FoxitAPIError,
    FoxitClient,
    FoxitConfig,
    Party,
    SignatureField,
)

BASE_URL = "https://na1.fusion.foxit.com/esign/api"


@pytest.fixture
def client():
    return FoxitClient(
        FoxitConfig(client_id="test-id", client_secret="test-secret", base_url=BASE_URL)
    )


@responses_lib.activate
def test_create_envelope_from_binary_sends_correct_headers_and_data(client, tmp_path):
    fake_pdf = tmp_path / "warrant.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4 fake pdf bytes")

    responses_lib.add(
        responses_lib.POST,
        f"{BASE_URL}/v1/folders/createfolder",
        json={"result": "success", "folderId": 2520579},
        status=200,
    )

    result = client.create_envelope_from_binary(
        pdf_path=fake_pdf,
        folder_name="Tegata Warrant",
        parties=[Party(first_name="Alice", last_name="Approver", email="alice@example.com")],
        fields=[
            SignatureField(
                type="signature", x=100, y=500, width=150, height=40, name="Approver Signature"
            )
        ],
    )

    assert result["folderId"] == 2520579

    sent = responses_lib.calls[0].request
    assert sent.headers["client_id"] == "test-id"
    assert sent.headers["client_secret"] == "test-secret"
    assert sent.headers["Content-Type"] == "application/json"
    # JSON body should use inputType:"base64", not multipart — see
    # foxit_client.py's 2026-08-30 rewrite (multipart returned a real
    # 403 in live testing; base64 is Foxit's documented method for
    # files not at a public URL, confirmed via developersguide.foxitesign.foxit.com)
    body = json.loads(sent.body)
    assert body["inputType"] == "base64"
    assert body["fileNames"] == ["warrant.pdf"]
    assert len(body["base64FileString"]) == 1
    # round-trip: decoding the base64 should give back the exact bytes written to fake_pdf
    decoded = base64.b64decode(body["base64FileString"][0])
    assert decoded == b"%PDF-1.4 fake pdf bytes"


@responses_lib.activate
def test_create_envelope_sends_correct_party_and_field_shape(client, tmp_path):
    fake_pdf = tmp_path / "warrant.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4 fake pdf bytes")

    responses_lib.add(
        responses_lib.POST,
        f"{BASE_URL}/v1/folders/createfolder",
        json={"result": "success", "folderId": 1},
        status=200,
    )

    client.create_envelope_from_binary(
        pdf_path=fake_pdf,
        folder_name="Tegata Warrant",
        parties=[
            Party(first_name="Alice", last_name="Approver", email="alice@example.com", sequence=1)
        ],
        fields=[
            SignatureField(type="signature", x=100, y=500, width=150, height=40, party=1),
        ],
    )

    sent_body = responses_lib.calls[0].request.body
    data_payload = json.loads(sent_body)

    assert data_payload["folderName"] == "Tegata Warrant"
    assert data_payload["parties"][0]["emailId"] == "alice@example.com"
    assert data_payload["parties"][0]["permission"] == "FILL_FIELDS_AND_SIGN"
    assert data_payload["fields"][0]["type"] == "signature"
    assert data_payload["fields"][0]["x"] == 100
    # tabOrder/partyResponsible confirmed required in Foxit's own real
    # dashboard sample (2026-08-30) — previously omitted entirely.
    assert data_payload["fields"][0]["tabOrder"] == 1
    assert data_payload["fields"][0]["partyResponsible"] == 1


@responses_lib.activate
def test_create_envelope_error_raises(client, tmp_path):
    fake_pdf = tmp_path / "warrant.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4 fake pdf bytes")

    responses_lib.add(
        responses_lib.POST,
        f"{BASE_URL}/v1/folders/createfolder",
        json={"message": "Invalid party email"},
        status=400,
    )

    with pytest.raises(FoxitAPIError) as exc_info:
        client.create_envelope_from_binary(
            pdf_path=fake_pdf,
            folder_name="x",
            parties=[Party(first_name="x", last_name="y", email="not-an-email")],
            fields=[],
        )
    assert exc_info.value.status_code == 400
    assert "Invalid party email" in exc_info.value.message


@responses_lib.activate
def test_get_envelope_details_matches_real_response_shape(client):
    # Exact real response shape from Foxit's own Postman collection example
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/v1/folders/myfolder",
        json={
            "result": "success",
            "folder": {
                "folderId": 86377,
                "folderName": "eSignGenie Sample",
                "folderStatus": "EXECUTED",
                "envelopeId": 86377,
            },
            "Folder History": [
                {
                    "firstName": "John",
                    "lastName": "Doe",
                    "email": "johndoe@example.com",
                    "envelopeId": 86377,
                    "dateChanged": 1564737942000,
                    "action": "Created",
                },
                {
                    "firstName": "Jane",
                    "lastName": "Doe",
                    "email": "janedoe@example.com",
                    "envelopeId": 86377,
                    "dateChanged": 1564738091000,
                    "action": "Signed",
                },
            ],
        },
        status=200,
    )

    result = client.get_envelope_details(86377)

    assert result["folder"]["folderStatus"] == "EXECUTED"
    actions = [entry["action"] for entry in result["Folder History"]]
    assert "Created" in actions
    assert "Signed" in actions

    sent = responses_lib.calls[0].request
    assert "folderId=86377" in sent.url


@responses_lib.activate
def test_download_envelope_files_returns_binary(client):
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/v1/folders/download",
        body=b"PK\x03\x04fake-zip-bytes",
        status=200,
        content_type="application/octet-stream",
    )

    result = client.download_envelope_files(86377)
    assert result.startswith(b"PK")


@responses_lib.activate
def test_cancel_envelope(client):
    responses_lib.add(
        responses_lib.POST,
        f"{BASE_URL}/v1/folders/cancelFolder",
        json={"result": "success"},
        status=200,
    )

    result = client.cancel_envelope(93, "no longer needed")
    assert result["result"] == "success"

    sent_body = json.loads(responses_lib.calls[0].request.body)
    assert sent_body["folderId"] == 93
    assert sent_body["reason_for_cancellation"] == "no longer needed"
