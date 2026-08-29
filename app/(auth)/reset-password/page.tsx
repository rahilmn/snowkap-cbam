import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";

import {
  ResetPasswordForm,
} from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-base">
          Set a new password
        </CardTitle>

        <CardDescription>
          Choose a new password for your account.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ResetPasswordForm />
      </CardContent>
    </Card>
  );
}
