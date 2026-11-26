import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegistrationForm, registrationSchema } from "@/pages/Register";
import { batchSchema } from "@/pages/RegisterBatch";
import { todayInput } from "@/utils/format";

describe("Participant registration form validation", () => {
  it("shows errors and does not submit when required fields are missing", async () => {
    const onSubmit = vi.fn();
    render(<RegistrationForm onSubmit={onSubmit} ipfsConfigured={false} />);
    await userEvent.click(screen.getByRole("button", { name: /register on blockchain/i }));
    expect(await screen.findByText("Choose a participant role")).toBeInTheDocument();
    expect(screen.getByText("Full name is required")).toBeInTheDocument();
    expect(screen.getByText("Location is required")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects invalid email / phone and submits valid data", async () => {
    const onSubmit = vi.fn();
    render(<RegistrationForm onSubmit={onSubmit} ipfsConfigured={false} />);
    await userEvent.click(screen.getByRole("radio", { name: /farmer/i }));
    await userEvent.type(screen.getByLabelText(/full name/i), "Ravi Kumar");
    await userEvent.type(screen.getByLabelText(/^location/i), "Coimbatore, Tamil Nadu");
    await userEvent.type(screen.getByLabelText(/email/i), "not-an-email");
    await userEvent.type(screen.getByLabelText(/phone/i), "abc");
    await userEvent.click(screen.getByRole("button", { name: /register on blockchain/i }));
    expect(await screen.findByText("Enter a valid email")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid phone number")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText(/email/i));
    await userEvent.type(screen.getByLabelText(/email/i), "ravi@example.com");
    await userEvent.clear(screen.getByLabelText(/phone/i));
    await userEvent.type(screen.getByLabelText(/phone/i), "+91 98765 43210");
    await userEvent.click(screen.getByRole("button", { name: /register on blockchain/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Ravi Kumar", role: "Farmer", email: "ravi@example.com" });
  });

  it("photo upload is disabled when IPFS is not configured", () => {
    render(<RegistrationForm onSubmit={vi.fn()} ipfsConfigured={false} />);
    expect(screen.getByLabelText(/profile photograph/i)).toBeDisabled();
  });

  it("schema trims and bounds fields", () => {
    expect(registrationSchema.safeParse({ name: "A".repeat(129), location: "X", role: "Farmer" }).success).toBe(false);
  });
});

describe("Batch form schema", () => {
  const valid = { productName: "Organic Tomatoes", category: "Vegetables", quantity: "500", unit: "kg", harvestDate: todayInput(), farmLocation: "Pollachi", state: "Tamil Nadu", district: "Coimbatore" };

  it("accepts a valid batch", () => {
    const r = batchSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.quantity).toBe(500);
  });

  it("rejects zero / fractional quantity, future harvest dates and missing fields", () => {
    const issues = (o: object) => {
      const r = batchSchema.safeParse({ ...valid, ...o });
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    expect(issues({ quantity: "0" })).toContain("Quantity must be greater than zero");
    expect(issues({ quantity: "2.5" })[0]).toMatch(/whole number/);
    expect(issues({ harvestDate: "2999-01-01" })).toContain("Harvest date cannot be in the future");
    expect(issues({ productName: "" })).toContain("Product name is required");
    expect(issues({ category: "" })).toContain("Choose a crop category");
  });
});
