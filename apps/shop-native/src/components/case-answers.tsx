import { MY_CASE_KIND, myCaseDueText, myCaseStatusWord } from "@yuntera/core";
import type { MyCase } from "@yuntera/db";
import { colors, radius, space } from "@yuntera/expo-kit/theme";
import { Badge, Card, formatDate, formatDateTime, Stack, Text } from "@yuntera/expo-kit/ui";
import { View } from "react-native";

/**
 * The shopper's cases with the answers staff wrote (my_cases), as the
 * website's components/case-answers.tsx shows them: in "Sus consultas" and on
 * an order's screen. A person's text is shown as text.
 */
export function CaseAnswers({ cases, showOrder }: { cases: MyCase[]; showOrder: boolean }) {
  return (
    <View style={{ gap: space[3] }} testID="case-answers">
      {cases.map((item) => (
        <Card key={item.id} testID="case-answer">
          <Stack gap={2}>
            <Text variant="bodyStrong">
              {MY_CASE_KIND[item.kind] ?? "Consulta"} {item.reference}
            </Text>
            <Badge tone={item.status === "closed" ? "success" : "info"}>
              {myCaseStatusWord(item)}
            </Badge>
            <Text variant="small" tint="muted">
              Desde el {formatDate(item.created_at, { day: "numeric", month: "long" })}
              {showOrder && item.order_number ? ` · pedido ${item.order_number}` : ""}
              {item.status === "open"
                ? ` · ${myCaseDueText(item.kind, formatDate(item.answer_due_on))}`
                : ""}
            </Text>
            {item.answers.length === 0 ? (
              <Text variant="small" tint="muted">
                Todavía no hay respuesta. Le avisamos cuando la haya.
              </Text>
            ) : (
              item.answers.map((answer) => (
                <View
                  key={answer.created_at}
                  style={{
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.md,
                    padding: space[3],
                    gap: space[1],
                  }}
                >
                  <Text variant="small" tint="muted">
                    Respuesta de {answer.author ?? "Yuntera"} · {formatDateTime(answer.created_at)}
                  </Text>
                  <Text testID="case-answer-body">{answer.body}</Text>
                </View>
              ))
            )}
          </Stack>
        </Card>
      ))}
    </View>
  );
}
