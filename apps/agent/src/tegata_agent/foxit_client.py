"""
Foxit eSign API client.

Auth confirmed from the real, live dashboard sample curl command (highest
confidence source — generated directly against this project's account,
not a generic doc example): headers `client_id` and `client_secret` sent
on every call, no OAuth token exchange step needed. Base URL:
https://na1.fusion.foxit.com/esign/api

Note: the official public Postman collection
(github.com/foxitsoftware/foxit-esign-postman-colllection) documents a
DIFFERENT auth flow (OAuth2 client_credentials -> bearer token) against a
generic {{default}} host. That collection appears to target the older
"eSignGenie" product line (its own examples reference
developers.esigngenie.com), not the unified Foxit Cloud API platform this
project's dashboard account lives on. The *body/endpoint shapes* from
that collection (folder creation, fields, parties) are still used here
since those are data formats independent of the auth mechanism — only
the auth headers differ from what the collection shows.

If client_id/client_secret headers ever stop working, try the
OAuth2 flow instead: POST /oauth2/access_token (form-urlencoded:
client_id, client_secret, grant_type=client_credentials, scope=read-write)
then send the returned token as Authorization: Bearer <token>.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import requests

FieldType = Literal["text", "date", "signature", "checkbox"]


class FoxitAPIError(Exception):
    def __init__(self, status_code: int, message: str, raw: dict | None = None):
        super().__init__(f"Foxit API error {status_code}: {message}")
        self.status_code = status_code
        self.message = message
        self.raw = raw or {}


@dataclass
class FoxitConfig:
    client_id: str
    client_secret: str
    base_url: str = "https://na1.fusion.foxit.com/esign/api"
    timeout_seconds: float = 30.0


@dataclass
class SignatureField:
    type: FieldType
    x: int
    y: int
    width: int
    height: int
    page_number: int = 1
    document_number: int = 1
    party: int = 1
    name: str | None = None
    required: bool = True
    text_field_name: str | None = None
    character_limit: int = 100

    def to_dict(self, tab_order: int = 1) -> dict[str, Any]:
        """tab_order and party_responsible confirmed required in Foxit's
        own real dashboard code sample (2026-08-30) -- previously
        omitted entirely. textfieldName/characterLimit/fontSize/
        fontFamily/fontColor added for type=="text" fields to match the
        same sample; not exercised by this project's actual signature-
        only field yet, included for completeness/consistency with the
        TS port."""
        d: dict[str, Any] = {
            "type": self.type,
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "pageNumber": self.page_number,
            "documentNumber": self.document_number,
            "tabOrder": tab_order,
            "party": self.party,
            "partyResponsible": self.party,
            "required": self.required,
        }
        if self.name:
            d["name"] = self.name
        if self.type == "text":
            d["textfieldName"] = self.text_field_name or self.name or f"field_{tab_order}"
            d["characterLimit"] = self.character_limit
            d["fontSize"] = 12
            d["fontFamily"] = "default"
            d["fontColor"] = "#000000"
        return d


@dataclass
class Party:
    first_name: str
    last_name: str
    email: str
    sequence: int = 1
    permission: str = "FILL_FIELDS_AND_SIGN"

    def to_dict(self) -> dict[str, Any]:
        return {
            "firstName": self.first_name,
            "lastName": self.last_name,
            "emailId": self.email,
            "permission": self.permission,
            "sequence": self.sequence,
            "allowNameChange": False,
        }


class FoxitClient:
    def __init__(self, config: FoxitConfig, session: requests.Session | None = None):
        self.config = config
        self.session = session or requests.Session()

    def _headers(self, content_type: str | None = "application/json") -> dict[str, str]:
        headers = {
            "client_id": self.config.client_id,
            "client_secret": self.config.client_secret,
            "Accept": "*/*",
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _handle_response(self, response: requests.Response) -> dict:
        try:
            data = response.json() if response.content else {}
        except ValueError:
            data = {}
        # Foxit's confirmed real error shape (from a live curl test,
        # 2026-08-30): {"result":"error","error_description":"invalid
        # folder id"} -- note error_description, NOT message. Also
        # confirmed: Foxit can return this error shape with HTTP 200,
        # not just a 4xx/5xx status -- checking status_code alone missed
        # that case.
        if response.status_code >= 400:
            raise FoxitAPIError(
                status_code=response.status_code,
                message=data.get(
                    "error_description", data.get("message", response.text or "Unknown error")
                ),
                raw=data,
            )
        if data.get("result") == "error":
            raise FoxitAPIError(
                status_code=response.status_code,
                message=data.get(
                    "error_description", "Foxit returned result: error with no error_description"
                ),
                raw=data,
            )
        return data

    def create_envelope_from_binary(
        self,
        pdf_path: str | Path,
        folder_name: str,
        parties: list[Party],
        fields: list[SignatureField],
        send_now: bool = True,
        create_embedded_signing_session: bool = False,
    ) -> dict:
        """Creates a signature envelope ("folder") from a local PDF file.
        Returns the parsed response (contains folderId once created --
        exact key confirmed via real API testing, see
        docs/foxit-envelope-response-shape.md once verified).

        CHANGED 2026-08-30: previously uploaded via multipart/form-data,
        which returned a real 403 in live testing (via the TS port,
        apps/web/lib/foxitClient.ts -- this Python client is the
        secondary reference implementation). Confirmed via Foxit's own
        developer docs (developersguide.foxitesign.foxit.com) that
        `inputType: "base64"` + a `base64FileString` array (paired with
        a matching `fileNames` array) is the documented method for files
        not at a public URL -- reads the file from disk and
        base64-encodes it in memory rather than uploading it as a
        multipart file part."""
        import base64
        import json as json_module

        pdf_path = Path(pdf_path)
        with open(pdf_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("ascii")

        data_payload = {
            "folderName": folder_name,
            "inputType": "base64",
            "base64FileString": [encoded],
            "fileNames": [pdf_path.name],
            "parties": [p.to_dict() for p in parties],
            "fields": [f.to_dict(tab_order=i + 1) for i, f in enumerate(fields)],
            "sendNow": send_now,
            "createEmbeddedSigningSession": create_embedded_signing_session,
        }
        # CONFIRMED required alongside createEmbeddedSigningSession=True
        # (2026-08-30, via the TS port hitting the real error): "email
        # id of embedded signer(s) not submitted". Matches the
        # documented example (developersguide.foxitesign.foxit.com)
        # showing embeddedSignersEmailIds as a separate array.
        if create_embedded_signing_session:
            data_payload["embeddedSignersEmailIds"] = [p.email for p in parties]

        url = f"{self.config.base_url}/v1/folders/createfolder"
        headers = self._headers(content_type="application/json")
        response = self.session.post(
            url,
            data=json_module.dumps(data_payload),
            headers=headers,
            timeout=self.config.timeout_seconds,
        )
        return self._handle_response(response)

    def get_envelope_details(self, folder_id: int | str) -> dict:
        """GET /v1/folders/myfolder?folderId=X — returns folder status,
        parties, fields, and the audit trail ("Folder History")."""
        url = f"{self.config.base_url}/v1/folders/myfolder"
        response = self.session.get(
            url,
            params={"folderId": folder_id},
            headers=self._headers(content_type=None),
            timeout=self.config.timeout_seconds,
        )
        return self._handle_response(response)

    def download_envelope_files(self, folder_id: int | str) -> bytes:
        """GET /v1/folders/download?folderId=X — returns a ZIP binary
        stream (all signed documents + signature certificate)."""
        url = f"{self.config.base_url}/v1/folders/download"
        headers = self._headers(content_type=None)
        headers["Accept"] = "application/octet-stream"
        response = self.session.get(
            url,
            params={"folderId": folder_id},
            headers=headers,
            timeout=self.config.timeout_seconds,
        )
        if response.status_code >= 400:
            raise FoxitAPIError(status_code=response.status_code, message=response.text)
        return response.content

    def cancel_envelope(self, folder_id: int | str, reason: str) -> dict:
        url = f"{self.config.base_url}/v1/folders/cancelFolder"
        response = self.session.post(
            url,
            json={"folderId": folder_id, "reason_for_cancellation": reason},
            headers=self._headers(),
            timeout=self.config.timeout_seconds,
        )
        return self._handle_response(response)
