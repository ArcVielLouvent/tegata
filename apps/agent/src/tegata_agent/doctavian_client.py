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
        return {
            "x-api-key": self.config.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

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
        """Registers a document template. Returns the parsed response body's
        result.data.documentTemplate object."""
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
