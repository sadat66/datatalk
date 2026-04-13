import { redirect } from "next/navigation";

import { SignupForm } from "./signup-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthUser } from "@/lib/supabase/auth";

export default async function SignupPage() {
  const user = await getAuthUser();
  if (user) {
    redirect("/dashboard");
  }

  return (
    <Card className="w-full max-w-md border-border bg-card shadow-sm">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-semibold tracking-tight">Create your account</CardTitle>
        <CardDescription className="text-muted-foreground">
          We will send a confirmation link to your inbox.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <SignupForm />
      </CardContent>
    </Card>
  );
}
