# apps/api/app/api/routes/payments.py

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_verified
from app.models.deposit import Deposit, DepositStatus
from app.models.meeting import Meeting, MeetingStatus
from app.models.confirmation import Confirmation
from app.models.chat_room import ChatRoom
from app.models.meeting_slot import MeetingSlot

router = APIRouter()

DEPOSIT_AMOUNT = 5000


# -------------------------
# Helpers
# -------------------------
def _ensure_user_is_meeting_member(db: Session, meeting_id: int, user_id: int) -> None:
    exists = db.execute(
        select(MeetingSlot.id).where(
            MeetingSlot.meeting_id == meeting_id,
            MeetingSlot.user_id == user_id,
        )
    ).first()
    if not exists:
        raise HTTPException(status_code=403, detail="You are not a member of this meeting.")


# -------------------------
# 1) Deposit Prepare
# -------------------------
@router.post("/payments/deposits/prepare")
def prepare_deposit(meeting_id: int, db: Session = Depends(get_db), user=Depends(require_verified)):
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(404, "Meeting not found")

    if meeting.status not in [MeetingStatus.FULL, MeetingStatus.WAITING_CONFIRM]:
        raise HTTPException(400, "Meeting not ready for confirm")

    _ensure_user_is_meeting_member(db, meeting_id, user.id)

    # ✅ idempotent: 이미 PENDING/HELD면 재사용
    existing = db.execute(
        select(Deposit).where(
            Deposit.meeting_id == meeting_id,
            Deposit.user_id == user.id,
            Deposit.status.in_([DepositStatus.PENDING, DepositStatus.HELD]),
        )
    ).scalar_one_or_none()

    if existing:
        return {
            "orderId": existing.toss_order_id,
            "amount": existing.amount,
            "orderName": f"MEETIN Deposit {meeting_id}",
        }

    order_id = str(uuid.uuid4())
    deposit = Deposit(
        meeting_id=meeting_id,
        user_id=user.id,
        amount=5000,
        status=DepositStatus.PENDING,
        toss_order_id=order_id,
    )

    try:
        db.add(deposit)
        db.commit()
    except IntegrityError:
        db.rollback()
        # 레이스 시 재조회해서 반환
        existing2 = db.execute(
            select(Deposit).where(
                Deposit.meeting_id == meeting_id,
                Deposit.user_id == user.id,
                Deposit.status.in_([DepositStatus.PENDING, DepositStatus.HELD]),
            )
        ).scalar_one_or_none()
        if existing2:
            return {
                "orderId": existing2.toss_order_id,
                "amount": existing2.amount,
                "orderName": f"MEETIN Deposit {meeting_id}",
            }
        raise HTTPException(400, "Deposit already exists")

    return {
        "orderId": order_id,
        "amount": 5000,
        "orderName": f"MEETIN Deposit {meeting_id}",
    }


# -------------------------
# 2) Toss Confirm
# -------------------------
@router.post("/payments/toss/confirm")
def confirm_payment(
    order_id: str,
    db: Session = Depends(get_db),
    user=Depends(require_verified),
):
    """
    Confirms a deposit payment (mock for now).
    Safe against:
      - wrong user using other's order_id
      - user leaving meeting before confirm
      - double calls (idempotent)
      - chat room double creation
    """
    try:
        # lock deposit row
        deposit: Optional[Deposit] = db.execute(
            select(Deposit).where(Deposit.toss_order_id == order_id).with_for_update()
        ).scalar_one_or_none()

        if not deposit:
            raise HTTPException(404, "Deposit not found")

        # ✅ (2/8) order owner check
        if deposit.user_id != user.id:
            raise HTTPException(403, "Not your deposit order")

        # lock meeting row
        meeting: Optional[Meeting] = db.execute(
            select(Meeting).where(Meeting.id == deposit.meeting_id).with_for_update()
        ).scalar_one_or_none()

        if not meeting:
            raise HTTPException(404, "Meeting not found")

        if meeting.status not in (MeetingStatus.FULL, MeetingStatus.WAITING_CONFIRM):
            raise HTTPException(409, "Meeting is not in confirmable state")

        # ✅ (2/8) still a member?
        _ensure_user_is_meeting_member(db, meeting.id, user.id)

        # ✅ idempotent confirm
        if deposit.status == DepositStatus.HELD:
            return {"status": "already_confirmed"}

        # TODO: real Toss confirm API call here
        deposit.status = DepositStatus.HELD

        # Create confirmation (unique constraint recommended on (meeting_id, user_id))
        confirmation = Confirmation(meeting_id=meeting.id, user_id=user.id)
        db.add(confirmation)
        try:
            db.flush()  # catch IntegrityError here
        except IntegrityError:
            raise HTTPException(400, "Already confirmed")

        # Move FULL -> WAITING_CONFIRM after first confirm
        if meeting.status == MeetingStatus.FULL:
            meeting.status = MeetingStatus.WAITING_CONFIRM

        # capacity from slots
        slots = db.execute(
            select(MeetingSlot).where(MeetingSlot.meeting_id == meeting.id)
        ).scalars().all()
        capacity = len(slots)

        confirmed_count = db.query(Confirmation).filter_by(meeting_id=meeting.id).count()
        held_count = db.query(Deposit).filter_by(
            meeting_id=meeting.id,
            status=DepositStatus.HELD,
        ).count()

        if confirmed_count == capacity and held_count == capacity:
            meeting.status = MeetingStatus.CONFIRMED

            db.add(ChatRoom(meeting_id=meeting.id))
            try:
                db.flush()  # IntegrityError would happen here
            except IntegrityError:
                pass

        db.commit()
        return {"status": "confirmed"}

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise