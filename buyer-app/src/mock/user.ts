import type { Address, PaymentMethod, UserProfile } from "@/types";

export const addresses: Address[] = [
  {
    id: "addr-home",
    label: "Home",
    name: "Aarav Sharma",
    phone: "+91 98765 43210",
    line1: "402, Sunrise Residency",
    line2: "Koramangala 4th Block",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560034",
    isDefault: true,
  },
  {
    id: "addr-work",
    label: "Work",
    name: "Aarav Sharma",
    phone: "+91 98765 43210",
    line1: "Tower B, 7th Floor, Tech Park",
    line2: "Outer Ring Road, Bellandur",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560103",
  },
];

export const paymentMethods: PaymentMethod[] = [
  { id: "pm-upi", type: "upi", label: "UPI", detail: "aarav@okhdfcbank", isDefault: true },
  { id: "pm-card", type: "card", label: "HDFC Credit Card", detail: "•••• 4242" },
  { id: "pm-cod", type: "cod", label: "Cash on Delivery", detail: "Pay when delivered" },
];

export const userProfile: UserProfile = {
  id: "user-1",
  name: "Aarav Sharma",
  email: "aarav.sharma@example.com",
  phone: "+91 98765 43210",
  avatar: "https://picsum.photos/seed/avatar/160/160",
  addresses,
  payments: paymentMethods,
  notifications: {
    orderUpdates: true,
    offers: true,
    recommendations: false,
  },
};
