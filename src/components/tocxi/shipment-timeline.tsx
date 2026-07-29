"use client";

import { cn } from "@/lib/shop/cn";
import type { TocxiShipmentStatus } from "@/lib/tocxi/types";

const STATUS_ORDER: TocxiShipmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

const STATUS_LABELS: Record<TocxiShipmentStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PICKED_UP: "Picked Up",
  IN_TRANSIT: "In Transit",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

type TimelineStep = {
  status: TocxiShipmentStatus;
  timestamp?: string;
};

export function ShipmentTimeline({
  currentStatus,
  events,
}: {
  currentStatus: string;
  events?: TimelineStep[];
}) {
  const normalized = currentStatus.toUpperCase() as TocxiShipmentStatus;
  const currentIdx = STATUS_ORDER.indexOf(normalized);
  const isTerminal = normalized === "FAILED" || normalized === "CANCELLED";

  if (isTerminal) {
    return (
      <div className="space-y-3">
        {STATUS_ORDER.map((status, idx) => {
          const isBefore = STATUS_ORDER.indexOf(status) <= currentIdx;
          const event = events?.find((e) => e.status === status);
          return (
            <div key={status} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "w-3 h-3 rounded-full border-2",
                    isBefore
                      ? "bg-blue-600 border-blue-600"
                      : "bg-white border-gray-300"
                  )}
                />
                {idx < STATUS_ORDER.length - 1 && (
                  <div
                    className={cn(
                      "w-0.5 h-8",
                      isBefore ? "bg-blue-600" : "bg-gray-200"
                    )}
                  />
                )}
              </div>
              <div className="pb-6">
                <p
                  className={cn(
                    "text-sm font-medium",
                    isBefore ? "text-gray-900" : "text-gray-400"
                  )}
                >
                  {STATUS_LABELS[status]}
                </p>
                {event?.timestamp && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {new Date(event.timestamp).toLocaleString("en-IN")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <div className="flex gap-3">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                "w-3 h-3 rounded-full border-2",
                normalized === "CANCELLED"
                  ? "bg-gray-400 border-gray-400"
                  : "bg-red-500 border-red-500"
              )}
            />
          </div>
          <div className="pb-6">
            <p className="text-sm font-medium text-gray-900">
              {STATUS_LABELS[normalized]}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {STATUS_ORDER.map((status, idx) => {
        const isComplete = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const event = events?.find((e) => e.status === status);

        return (
          <div key={status} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-3 h-3 rounded-full border-2",
                  isComplete || isCurrent
                    ? "bg-blue-600 border-blue-600"
                    : "bg-white border-gray-300"
                )}
              />
              {idx < STATUS_ORDER.length - 1 && (
                <div
                  className={cn(
                    "w-0.5 h-8",
                    isComplete ? "bg-blue-600" : "bg-gray-200"
                  )}
                />
              )}
            </div>
            <div className="pb-6">
              <p
                className={cn(
                  "text-sm font-medium",
                  isComplete || isCurrent ? "text-gray-900" : "text-gray-400"
                )}
              >
                {STATUS_LABELS[status]}
                {isCurrent && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    Current
                  </span>
                )}
              </p>
              {event?.timestamp && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date(event.timestamp).toLocaleString("en-IN")}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
