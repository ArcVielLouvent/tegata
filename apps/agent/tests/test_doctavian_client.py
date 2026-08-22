import pytest
import responses as responses_lib

from tegata_agent.doctavian_client import (
    DoctavianAPIError,
    DoctavianClient,
    DoctavianConfig,
    TemplateVariable,
)

BASE_URL = "https://demo.api.doctavian.com"


@pytest.fixture
def client():
    return DoctavianClient(DoctavianConfig(api_key="test-key", base_url=BASE_URL))


@responses_lib.activate
def test_create_template_success_matches_real_response_shape(client):
    # This is the exact response body Doctavian's real API returns, per
    # the Postman collection example.
    responses_lib.add(
        responses_lib.POST,
        f"{BASE_URL}/v1/documents/template/create",
        json={
            "result": {
                "data": {
                    "documentTemplate": {
                        "documentTemplateGuid": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
                        "name": "Tegata Warrant",
                        "fileFormat": "docx",
                        "loadMethod": "Storage",
                        "path": "templates/tegata-warrant.docx",
                        "isDeleted": False,
                    }
                },
                "statusCode": 200,
                "message": "OK",
            },
            "origin": "https://app.example.com",
            "operationId": "0HN7GK9M4T2R5",
        },
        status=200,
    )

    result = client.create_template(
        name="Tegata Warrant",
        description="Time-boxed access authorization document.",
        title="Warrant",
        urn="9f86d081-884c-4d30-8934-9c1e6cbcb9f5",
        url="https://storage.example.com/templates/tegata-warrant.docx",
        path="templates/tegata-warrant.docx",
    )

    assert result["documentTemplateGuid"] == "7c9e6679-7425-40de-944b-e07fc1f90ae7"
    assert result["name"] == "Tegata Warrant"

    # verify the request body/headers actually sent were correct
    sent = responses_lib.calls[0].request
    assert sent.headers["x-api-key"] == "test-key"
    import json

    sent_body = json.loads(sent.body)
    assert sent_body["name"] == "Tegata Warrant"
    assert sent_body["fileFormat"] == "docx"
    assert sent_body["loadMethod"] == "Storage"


@responses_lib.activate
def test_create_template_validation_error_matches_real_error_shape(client):
    # Exact 400 error shape from the real API example.
    responses_lib.add(
        responses_lib.POST,
        f"{BASE_URL}/v1/documents/template/create",
        json={"code": "DATA_NAME_REQUIRED", "message": "Name is required."},
        status=400,
    )

    with pytest.raises(DoctavianAPIError) as exc_info:
        client.create_template(
            name="",
            description="x",
            title="x",
            urn="x",
            url="https://storage.example.com/x.docx",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "DATA_NAME_REQUIRED"


@responses_lib.activate
def test_create_template_unauthorized_raises(client):
    responses_lib.add(
        responses_lib.POST,
        f"{BASE_URL}/v1/documents/template/create",
        body="",
        status=401,
    )

    with pytest.raises(DoctavianAPIError) as exc_info:
        client.create_template(
            name="x", description="x", title="x", urn="x", url="https://storage.example.com/x.docx"
        )
    assert exc_info.value.status_code == 401


@responses_lib.activate
def test_generate_document_success_matches_real_response_shape(client):
    # Exact 201 response shape from the real API example.
    responses_lib.add(
        responses_lib.POST,
        f"{BASE_URL}/v1/documents/document/generate",
        json={
            "result": {
                "statusCode": "201",
                "message": "Created",
                "data": {
                    "document": {
                        "deliveryMethod": "Storage",
                        "name": "Tegata Warrant - req-001",
                        "fileFormat": "docx",
                        "urn": "c72f4a1e-9d3b-4c5f-8a6e-1b2c3d4e5f6a:Tegata Warrant - req-001.docx",
                    }
                },
            },
            "consumption": [
                {"dimension": "pages-generated", "value": 1},
                {"dimension": "documents-generated", "value": 1},
            ],
            "externalContext": {"actionRequestId": "req-001"},
            "operationId": "0HN7GK9M4T2R5",
        },
        status=201,
    )

    result = client.generate_document(
        template_name="Tegata Warrant",
        template_urn="9f86d081-884c-4d30-8934-9c1e6cbcb9f5",
        document_name="Tegata Warrant - req-001",
        variables=[
            TemplateVariable(name="resource", value="db_payment_prod", type="global"),
            TemplateVariable(name="risk_score", value="92", type="global"),
            TemplateVariable(name="risk_tier", value="high", type="global"),
            TemplateVariable(name="required_approver_count", value="2", type="global"),
        ],
        external_request_id="req-001",
    )

    assert result["urn"].endswith("Tegata Warrant - req-001.docx")
    assert result["fileFormat"] == "docx"

    import json

    sent_body = json.loads(responses_lib.calls[0].request.body)
    assert sent_body["externalContext"]["id"] == "req-001"
    var_names = {v["name"] for v in sent_body["data"]["variables"]}
    assert var_names == {"resource", "risk_score", "risk_tier", "required_approver_count"}


@responses_lib.activate
def test_generate_document_template_not_found_matches_real_error_shape(client):
    # Exact 400 nested-error shape from the real API example.
    responses_lib.add(
        responses_lib.POST,
        f"{BASE_URL}/v1/documents/document/generate",
        json={
            "error": {
                "statusCode": "400",
                "message": "Bad Request",
                "innerErrors": [
                    {
                        "code": "TEMPLATE_NOT_FOUND",
                        "message": "The specified template could not be located.",
                        "userMessage": (
                            "We couldn't generate your document. "
                            "Please check the template reference and try again."
                        ),
                        "eventId": "a1b2c3d4",
                    }
                ],
                "externalErrors": [],
            },
            "externalContext": {"actionRequestId": "req-001"},
        },
        status=400,
    )

    with pytest.raises(DoctavianAPIError) as exc_info:
        client.generate_document(
            template_name="Nonexistent",
            template_urn="does-not-exist",
            document_name="doc",
            variables=[],
            external_request_id="req-001",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "TEMPLATE_NOT_FOUND"
    assert "couldn't generate" in exc_info.value.message
