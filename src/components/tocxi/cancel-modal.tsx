"use client";

import * as React from "react";
import { Button, Label } from "./tocxi-ui";

export function CancelModal({
  open,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = React.useState("");

  React.useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900">Cancel Shipment</h3>
        <p className="text-sm text-gray-500 mt-1">
          Are you sure you want to cancel this shipment? This action cannot be undone.
        </p>

        <div className="mt-4">
          <Label htmlFor="cancel-reason">Reason for cancellation</Label>
          <textarea
            id="cancel-reason"
            className="mt-1 flex w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 min-h-[80px]"
            placeholder="Enter reason..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Keep Shipment
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(reason || "Cancelled by user")}
            disabled={loading}
          >
            {loading ? "Cancelling..." : "Confirm Cancellation"}
          </Button>
        </div>
      </div>
    </div>
  );
}
