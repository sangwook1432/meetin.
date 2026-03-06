"use client";

/**
 * /meetings/[id] — 미팅 상세 페이지
 *
 * 핵심 UI:
 * 1. 팀별 슬롯 + confirmed/대기중 뱃지 (TeamSection → SlotCard)
 * 2. 상태별 액션 버튼
 *    - RECRUITING : [참가하기] / [참가중] / [나가기]
 *    - WAITING_CONFIRM : [확정하기] (내가 아직 안 했을 때) / [확정 완료]
 *    - CONFIRMED : [채팅방 입장]
 * 3. CONFIRMED 전환 직후 → 자동으로 /chats/[roomId]로 이동
 */

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getMeeting,
  joinMeeting,
  leaveMeeting,
  confirmMeeting,
} from "@/lib/api";
import type { MeetingDetail, MeetingStatus } from "@/types";
import { TeamSection } from "@/components/meeting/TeamSection";

// ─── 상태 뱃지 색상 ───────────────────────────────────────
const STATUS_BADGE: Record<MeetingStatus, { label: string; className: string }> = {
  RECRUITING: { label: "모집중", className: "bg-blue-100 text-blue-700" },
  FULL: { label: "정원마감", className: "bg-gray-100 text-gray-600" },
  WAITING_CONFIRM: { label: "참가확정 대기", className: "bg-yellow-100 text-yellow-700" },
  CONFIRMED: { label: "확정 완료", className: "bg-emerald-100 text-emerald-700" },
  CANCELLED: { label: "취소됨", className: "bg-red-100 text-red-600" },
};

const MEETING_TYPE_LABEL: Record<string, string> = {
  TWO_BY_TWO: "2 : 2",
  THREE_BY_THREE: "3 : 3",
};

export default function MeetingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const meetingId = Number(params.id);

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 폴링: WAITING_CONFIRM 상태에서 다른 유저의 confirm을 실시간 반영
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMeeting = async () => {
    try {
      const data = await getMeeting(meetingId);
      setMeeting(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeeting();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // WAITING_CONFIRM 상태일 때 5초마다 폴링
  useEffect(() => {
    if (meeting?.status === "WAITING_CONFIRM") {
      pollingRef.current = setInterval(fetchMeeting, 5000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting?.status]);

  // ─── 액션 핸들러 ──────────────────────────────────────────

  const handleJoin = async () => {
    setActionLoading(true);
    try {
      await joinMeeting(meetingId);
      await fetchMeeting();
    } catch (e) {
      alert(e instanceof Error ? e.message : "참가 실패");
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!confirm("정말 나가시겠습니까?")) return;
    setActionLoading(true);
    try {
      const res = await leaveMeeting(meetingId);
      if (res.meeting_deleted) {
        router.push("/discover");
      } else {
        await fetchMeeting();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "나가기 실패");
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirm = async () => {
    setActionLoading(true);
    try {
      const res = await confirmMeeting(meetingId);

      // ✅ 전원 확정 → CONFIRMED 전환 → 채팅방으로 자동 이동
      if (res.status === "CONFIRMED" && res.chat_room_id) {
        router.push(`/chats/${res.chat_room_id}`);
        return;
      }

      // 아직 다른 사람 대기 중 → 상세 새로고침
      await fetchMeeting();
    } catch (e) {
      alert(e instanceof Error ? e.message : "확정 실패");
    } finally {
      setActionLoading(false);
    }
  };

  const handleEnterChat = () => {
    if (meeting?.chat_room_id) {
      router.push(`/chats/${meeting.chat_room_id}`);
    }
  };

  // ─── 렌더 ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">로딩 중...</div>
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50">
        <p className="text-red-500 text-sm">{error ?? "미팅을 찾을 수 없습니다"}</p>
        <button
          onClick={() => router.back()}
          className="text-sm text-blue-600 underline"
        >
          뒤로가기
        </button>
      </div>
    );
  }

  const badge = STATUS_BADGE[meeting.status];

  // confirmed 진행률 계산 (WAITING_CONFIRM 전용)
  const memberSlots = meeting.slots.filter((s) => s.user !== null);
  const confirmedCount = memberSlots.filter((s) => s.confirmed).length;
  const totalMembers = memberSlots.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md">
        {/* 헤더 */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3">
          <button
            onClick={() => router.back()}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            ←
          </button>
          <span className="font-semibold text-gray-900">미팅 상세</span>
        </div>

        <div className="px-4 py-5 space-y-5">
          {/* 미팅 기본 정보 카드 */}
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {MEETING_TYPE_LABEL[meeting.meeting_type] ?? meeting.meeting_type}
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                  미팅 #{meeting.meeting_id}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.className}`}
              >
                {badge.label}
              </span>
            </div>

            {/* 참가 현황 */}
            <div className="mt-4 flex items-center gap-4 text-sm text-gray-600">
              <span>👨 남성 {meeting.filled.male}/{meeting.filled.capacity / 2}명</span>
              <span className="text-gray-300">|</span>
              <span>👩 여성 {meeting.filled.female}/{meeting.filled.capacity / 2}명</span>
            </div>

            {/* WAITING_CONFIRM 확정 진행률 */}
            {meeting.status === "WAITING_CONFIRM" && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                  <span>참가 확정 현황</span>
                  <span className="font-semibold text-yellow-600">
                    {confirmedCount} / {totalMembers} 확정
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full bg-yellow-400 transition-all duration-500"
                    style={{
                      width: `${totalMembers > 0 ? (confirmedCount / totalMembers) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 팀 슬롯 — 핵심 UI */}
          <div className="space-y-4">
            <TeamSection team="MALE" slots={meeting.slots} />
            <TeamSection team="FEMALE" slots={meeting.slots} />
          </div>

          {/* 액션 영역 */}
          <ActionArea
            meeting={meeting}
            actionLoading={actionLoading}
            onJoin={handleJoin}
            onLeave={handleLeave}
            onConfirm={handleConfirm}
            onEnterChat={handleEnterChat}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 액션 버튼 영역 (상태별 분기)
// ─────────────────────────────────────────────

interface ActionAreaProps {
  meeting: MeetingDetail;
  actionLoading: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onConfirm: () => void;
  onEnterChat: () => void;
}

function ActionArea({
  meeting,
  actionLoading,
  onJoin,
  onLeave,
  onConfirm,
  onEnterChat,
}: ActionAreaProps) {
  const { status, is_member, my_confirmed, chat_room_id, filled } = meeting;

  // ── CONFIRMED: 채팅방 입장 버튼만 표시
  if (status === "CONFIRMED") {
    return (
      <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5 text-center space-y-3">
        <div className="text-emerald-700 font-semibold">🎉 모든 멤버가 확정했습니다!</div>
        <p className="text-sm text-emerald-600">채팅방에서 만날 장소를 정해보세요.</p>
        {chat_room_id && (
          <button
            onClick={onEnterChat}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 active:scale-95 transition-all"
          >
            💬 채팅방 입장
          </button>
        )}
      </div>
    );
  }

  // ── WAITING_CONFIRM: 확정하기 버튼
  if (status === "WAITING_CONFIRM" && is_member) {
    if (my_confirmed) {
      return (
        <div className="rounded-2xl bg-yellow-50 border border-yellow-200 p-5 text-center">
          <div className="text-yellow-700 font-semibold mb-1">✅ 참가 확정 완료</div>
          <p className="text-sm text-yellow-600">
            다른 멤버들의 확정을 기다리고 있습니다...
          </p>
          {/* 폴링으로 자동 갱신되므로 별도 새로고침 버튼 불필요 */}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-700">
          ⚠️ 모든 슬롯이 채워졌습니다. 참가를 확정해주세요.
        </div>
        <button
          onClick={onConfirm}
          disabled={actionLoading}
          className="w-full rounded-xl bg-yellow-400 py-3.5 text-sm font-bold text-white hover:bg-yellow-500 disabled:opacity-50 active:scale-95 transition-all"
        >
          {actionLoading ? "처리 중..." : "✅ 참가 확정하기"}
        </button>
        <button
          onClick={onLeave}
          disabled={actionLoading}
          className="w-full rounded-xl border border-red-200 bg-white py-3 text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-50 transition-all"
        >
          나가기
        </button>
      </div>
    );
  }

  // ── RECRUITING
  if (status === "RECRUITING") {
    const isFull = filled.total >= filled.capacity;

    if (is_member) {
      return (
        <div className="space-y-3">
          <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
            참가 중입니다. 팀이 모두 모이면 확정 단계로 진행됩니다.
          </div>
          <button
            onClick={onLeave}
            disabled={actionLoading}
            className="w-full rounded-xl border border-red-200 bg-white py-3 text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-50 transition-all"
          >
            {actionLoading ? "처리 중..." : "나가기"}
          </button>
        </div>
      );
    }

    if (isFull) {
      return (
        <div className="rounded-xl bg-gray-100 px-4 py-3 text-center text-sm text-gray-500">
          정원이 마감되었습니다
        </div>
      );
    }

    return (
      <button
        onClick={onJoin}
        disabled={actionLoading}
        className="w-full rounded-xl bg-blue-600 py-3.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 active:scale-95 transition-all"
      >
        {actionLoading ? "처리 중..." : "참가하기"}
      </button>
    );
  }

  return null;
}
