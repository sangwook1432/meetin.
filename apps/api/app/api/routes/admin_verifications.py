from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.deps import get_db, require_admin
from app.models.user import User, VerificationStatus
from app.models.verification_doc import VerificationDoc, DocStatus
from app.schemas.verification import AdminVerificationAction, AdminUserVerificationOut

router = APIRouter()


@router.get("/verifications", response_model=list[AdminUserVerificationOut])
def list_verifications(
    status: VerificationStatus = VerificationStatus.PENDING,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    q = (
        db.query(
            User.id.label("user_id"),
            User.email,
            User.university,
            User.verification_status,
            func.count(VerificationDoc.id).label("doc_count"),
        )
        .outerjoin(VerificationDoc, VerificationDoc.user_id == User.id)
        .filter(User.verification_status == status)
        .group_by(User.id)
        .order_by(User.id.desc())
    )
    rows = q.all()
    return [
        AdminUserVerificationOut(
            user_id=r.user_id,
            email=r.email,
            university=r.university,
            verification_status=r.verification_status,
            doc_count=int(r.doc_count or 0),
        )
        for r in rows
    ]


@router.post("/verifications/{user_id}/approve")
def approve(
    user_id: int,
    payload: AdminVerificationAction,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.verification_status = VerificationStatus.VERIFIED

    db.query(VerificationDoc).filter(VerificationDoc.user_id == user_id).update(
        {"status": DocStatus.REVIEWED, "note": payload.note}
    )

    db.add(user)
    db.commit()
    return {"ok": True}


@router.post("/verifications/{user_id}/reject")
def reject(
    user_id: int,
    payload: AdminVerificationAction,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.verification_status = VerificationStatus.REJECTED

    db.query(VerificationDoc).filter(VerificationDoc.user_id == user_id).update(
        {"status": DocStatus.REVIEWED, "note": payload.note}
    )

    db.add(user)
    db.commit()
    return {"ok": True}
