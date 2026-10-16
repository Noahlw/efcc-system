import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { useAppForm, withForm } from "../../src/components/ui/app-form";

const ContactFields = withForm({
  defaultValues: { phone: "" },
  render: ({ form }) => (
    <form.AppField name="phone">
      {(field) => <field.TextField id="contact-phone" label="Contact phone" />}
    </form.AppField>
  ),
});

// Canonical typecheck exercises the actual exported composition inference.
const rejectWrongFields = () =>
  withForm({
    defaultValues: { phone: "" },
    render: ({ form }) => {
      // @ts-expect-error A nonexistent field must not become an untyped escape.
      form.setFieldValue("missing", "contact");
      // @ts-expect-error The existing field retains its string value type.
      form.setFieldValue("phone", false);
      return null;
    },
  });
void rejectWrongFields;

const ContactForm = () => {
  const form = useAppForm({ defaultValues: { phone: "Synthetic-contact" } });
  return <ContactFields form={form} />;
};

it("composed fields render the owning form's actual initial contact value", () => {
  const markup = renderToStaticMarkup(<ContactForm />);
  expect(markup).toContain("Contact phone");
  expect(markup).toContain('value="Synthetic-contact"');
});
