"use client";

import { Button } from "@/components/ui/button";
import { ShellState } from "@/components/layout/shell-state";

export default function Error({ retry }: { error: Error; retry: () => void }) {
  return (
    <ShellState
      title="Что-то пошло не так"
      description="Попробуйте обновить этот раздел. Если ошибка повторится, мы разберёмся с ней по серверным логам."
      action={
        <Button type="button" variant="outline" onClick={() => retry()}>
          Повторить
        </Button>
      }
    />
  );
}
