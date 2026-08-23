"""
Doctavian API client.

Endpoints and payload shapes here are copied EXACTLY from the real Postman
collection Doctavian's team sent (not guessed from the OpenAPI spec, which
we could only partially fetch). If Doctavian ever changes their API, this
is the file to update — and update tests/test_doctavian_client.py to match.

Auth: `x-api-key` header (confirmed via the account-setup email from
Doctavian/Maven Mule, consistent with the `apiKeyHeader` security scheme
seen in their OpenAPI spec).
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import requests

VariableType = Literal["fieldExpression", "graphql", "global"]


class DoctavianAPIError(Exception):
    def __init__(self, status_code: int, code: str | None, message: str, raw: dict | None = None):
        super().__init__(f"Doctavian API error {status_code} ({code}): {message}")
        self.status_code = status_code
        self.code = code
        self.message = message
        self.raw = raw or {}


@dataclass
class DoctavianConfig:
    api_key: str
    base_url: str = "https://demo.api.doctavian.com"
    timeout_seconds: float = 30.0
    access_token: str | None = None
    """OAuth 2.0 bearer token (Microsoft Entra ID, per their Quickstart docs).
    Every real call needs both api_key AND this token in Authorization.
    This token is short-lived (their docs: rejected within ~2 minutes of
    expiry) and currently obtained MANUALLY via Postman's "Get New Access
    Token" button — their OAuth client is configured with a Postman-only
    redirect_uri (oauth.pstmn.io), so a custom PKCE flow in our own code
    cannot complete the login step. Re-generate and update .env when it
    expires; do not build a full PKCE flow into this client under hackathon
    time constraints unless there's time left over as a stretch."""


@dataclass
class TemplateVariable:
    name: str
    value: str
    type: VariableType = "global"

    def to_dict(self) -> dict[str, str]:
        return {"name": self.name, "value": self.value, "type": self.type}


class DoctavianClient:
    def __init__(self, config: DoctavianConfig, session: requests.Session | None = None):
        self.config = config
        self.session = session or requests.Session()

    def _headers(self) -> dict[str, str]:
        headers = {
            "x-api-key": self.config.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self.config.access_token:
            headers["Authorization"] = f"Bearer {self.config.access_token}"
        return headers

    def _post(self, path: str, body: dict) -> dict:
        url = f"{self.config.base_url}{path}"
        response = self.session.post(
            url, json=body, headers=self._headers(), timeout=self.config.timeout_seconds
        )
        try:
            data = response.json() if response.content else {}
        except ValueError:
            data = {}

        if response.status_code >= 400:
            # Doctavian's error shape (per the real API): either a flat
            # {"code": ..., "message": ...} (validation errors) or a nested
            # {"error": {"statusCode": ..., "message": ..., "innerErrors": [...]}}
            if "error" in data:
                inner = data["error"]
                first_inner = (inner.get("innerErrors") or [{}])[0]
                raise DoctavianAPIError(
                    status_code=response.status_code,
                    code=first_inner.get("code"),
                    message=first_inner.get("userMessage") or inner.get("message", "Unknown error"),
                    raw=data,
                )
            raise DoctavianAPIError(
                status_code=response.status_code,
                code=data.get("code"),
                message=data.get("message", "Unknown error"),
                raw=data,
            )

        return data

    def _upload(self, file_path: str | Path, endpoint: str, storage_type: str) -> dict:
        """Shared multipart upload logic for both /document/upload and
        /template/upload — same request/response shape, different endpoint
        and storage semantics."""
        file_path = Path(file_path)
        url = f"{self.config.base_url}{endpoint}"
        headers = {
            "x-api-key": self.config.api_key,
            "Accept": "application/json",
        }
        if self.config.access_token:
            headers["Authorization"] = f"Bearer {self.config.access_token}"
        # NOTE: deliberately no Content-Type header here — requests sets the
        # correct multipart/form-data boundary automatically when `files=`
        # is used. Setting it manually breaks the boundary.

        with open(file_path, "rb") as f:
            files = {"file": (file_path.name, f)}
            headers["X-Storage-Type"] = storage_type
            response = self.session.post(
                url, files=files, headers=headers, timeout=self.config.timeout_seconds
            )

        try:
            data = response.json() if response.content else {}
        except ValueError:
            data = {}

        if response.status_code >= 400:
            if "error" in data:
                inner = data["error"]
                first_inner = (inner.get("innerErrors") or [{}])[0]
                raise DoctavianAPIError(
                    status_code=response.status_code,
                    code=first_inner.get("code"),
                    message=first_inner.get("userMessage") or inner.get("message", "Unknown error"),
                    raw=data,
                )
            raise DoctavianAPIError(
                status_code=response.status_code,
                code=data.get("code"),
                message=data.get("message", "Unknown error"),
                raw=data,
            )

        return data["result"]["data"]["files"][0]

    def upload_document(self, file_path: str | Path) -> dict:
        """Uploads a physical file to general Storage (X-Storage-Type:
        document-template). Returns {"id": ..., "fileName": ...}.

        NOTE: for the Tegata pipeline, prefer upload_template() instead —
        this generic upload's returned id is NOT directly usable as a
        Document Generate template.urn without a separate
        Document Template Create step, and that step requires a
        well-formed absolute URI in its `url` field (confirmed via real
        API testing: a bare storage id is rejected with
        TEMPLATE_URL_INVALID). upload_template() below is the endpoint
        Doctavian's own quickstart missions use for exactly this purpose,
        and its returned id can be passed directly as template.urn.
        """
        return self._upload(
            file_path, "/v1/documents/document/upload", storage_type="document-template"
        )

    def upload_template(self, file_path: str | Path) -> dict:
        """Uploads a template file specifically for use as a
        Document Generate source (POST /v1/documents/template/upload).
        Returns {"id": ..., "fileName": ...} — pass the "id" directly as
        generate_document's template_urn, no separate create_template()
        call needed.

        IMPORTANT: per Doctavian's own docs, uploaded templates are
        automatically deleted from Storage after the next
        document-generation request that consumes them (success or
        failure) — re-upload before each generation, don't cache the id
        for reuse across multiple generate calls.
        """
        return self._upload(
            file_path, "/v1/documents/template/upload", storage_type="document-template"
        )

    def upload_data(self, file_path: str | Path) -> dict:
        """Uploads a JSON data file for use as a Document Generate data
        source (POST /v1/documents/data/upload, X-Storage-Type:
        document-data). Returns {"id": ..., "fileName": ...} — pass the
        "id" as generate_document's data_urn.

        Confirmed necessary via Doctavian's own quickstart mission
        examples: every real Document Generate call pairs a
        template.urn (from upload_template) with a data.urn (from this
        method) — omitting data.urn was the actual cause of
        GET_FILE_FROM_STORAGE_FAILED in earlier testing, not a problem
        with the template itself.

        Same single-use lifecycle as upload_template(): the uploaded
        data file is deleted after the next generate call consumes it.
        Accepted extension: .json only.
        """
        return self._upload(file_path, "/v1/documents/data/upload", storage_type="document-data")

    def create_template(
        self,
        name: str,
        description: str,
        title: str,
        urn: str,
        url: str,
        file_format: str = "docx",
        load_method: str = "Storage",
        path: str | None = None,
    ) -> dict:
        """Registers a PERMANENT, named document template with metadata.
        Returns the parsed response body's result.data.documentTemplate
        object.

        NOT part of the Tegata critical path — Tegata re-uploads a fresh
        template per generation via upload_template() instead, since our
        templates are simple and don't need permanent named storage. This
        method is kept for potential future use (e.g. a template library
        feature) but is untested against the real API's `url` field
        requirements (must be a well-formed absolute URI — exact expected
        format for storage-hosted files is undocumented; a bare storage id
        was rejected with TEMPLATE_URL_INVALID)."""
        body = {
            "name": name,
            "description": description,
            "title": title,
            "urn": urn,
            "url": url,
            "fileFormat": file_format,
            "loadMethod": load_method,
        }
        if path is not None:
            body["path"] = path

        data = self._post("/v1/documents/template/create", body)
        return data["result"]["data"]["documentTemplate"]

    def generate_document(
        self,
        template_name: str,
        template_urn: str,
        document_name: str,
        variables: list[TemplateVariable],
        external_request_id: str,
        template_file_format: str = "docx",
        template_load_method: str = "Storage",
        document_file_format: str = "docx",
        document_delivery_method: str = "Storage",
        document_path: str = "root",
        data_urn: str | None = None,
        data_load_method: str = "Storage",
    ) -> dict:
        """Generates a document from a template + variables. Returns the
        parsed response body's result.data.document object.

        Raises DoctavianAPIError on failure (e.g. TEMPLATE_NOT_FOUND)."""
        body: dict[str, Any] = {
            "externalContext": {"id": external_request_id},
            "template": {
                "name": template_name,
                "urn": template_urn,
                "fileFormat": template_file_format,
                "loadMethod": template_load_method,
            },
            "data": {
                "loadMethod": data_load_method,
                "variables": [v.to_dict() for v in variables],
            },
            "document": {
                "name": document_name,
                "fileFormat": document_file_format,
                "deliveryMethod": document_delivery_method,
                "path": document_path,
            },
        }
        if data_urn is not None:
            body["data"]["urn"] = data_urn

        data = self._post("/v1/documents/document/generate", body)
        return data["result"]["data"]["document"]
