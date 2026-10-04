"""GET /me: who is logged in, their companies and the one in use."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import get_user_session

router = APIRouter()


@router.get("/me", tags=["Sistema"])
def me(user: dict = Depends(get_user_session)):
    """The user, all their companies and the active one with its role.

    With several companies and no ``X-Org-Id`` it still answers 200, with
    ``org_id`` and ``role`` in null: the screen shows the company picker.
    """
    return {
        "user_id": user["user_id"],
        "email": user.get("email"),
        "org_id": user.get("org_id"),
        "role": user.get("role"),
        "orgs": user.get("orgs") or [],
    }
