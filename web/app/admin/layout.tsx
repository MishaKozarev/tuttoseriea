import type { Metadata } from "next";
import type { ReactNode } from "react";

import { adminNoindexMetadata } from "@/src/seo/site";

export const metadata: Metadata = adminNoindexMetadata;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
