const readline = require("node:readline");
const { Writable } = require("node:stream");

const hiddenOutput = new Writable({
    write(chunk, encoding, callback) {
        callback();
    },
});

async function main() {
    const input = readline.createInterface({
        input: process.stdin,
        output: hiddenOutput,
        terminal: true,
    });

    process.stdout.write("Admin temporary password: ");

    const password = await new Promise((resolve) => {
        input.question("", resolve);
    });

    input.close();
    process.stdout.write("\n");

    const response = await fetch(
        "http://127.0.0.1:5000/api/auth/login",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: "admin001", password }),
        }
    );

    const data = await response.json();
    if (response.ok && data.token) {
        const dashboard = await fetch(
            "http://127.0.0.1:5000/api/dashboard",
            {
                headers: {
                    Authorization: `Bearer ${data.token}`,
                },
            }
        );

        console.log("Dashboard HTTP status:", dashboard.status);
        console.log(await dashboard.json());
        if (data.user.requirements.password_change) {
            const changeInput = readline.createInterface({
                input: process.stdin,
                output: hiddenOutput,
                terminal: true,
            });

            process.stdout.write("New password: ");
            const newPassword = await new Promise((resolve) => {
                changeInput.question("", resolve);
            });

            process.stdout.write("\nConfirm new password: ");
            const confirmation = await new Promise((resolve) => {
                changeInput.question("", resolve);
            });

            changeInput.close();
            process.stdout.write("\n");

            if (newPassword !== confirmation) {
                console.log("Passwords do not match. Nothing changed.");
                return;
            }

            const changed = await fetch(
                "http://127.0.0.1:5000/api/auth/change-password",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${data.token}`,
                    },
                    body: JSON.stringify({
                        current_password: password,
                        new_password: newPassword,
                    }),
                }
            );

            console.log("Password change HTTP status:", changed.status);
            console.log(await changed.json());
        }
    }
    console.log("HTTP status:", response.status);
    console.log(JSON.stringify(data.user || data, null, 2)
        .replace(/"token"\s*:\s*"[^"]*"/g, '"token": "[HIDDEN]"'));
}

main().catch(() => {
    console.error("Request failed. Check that the backend is running.");
    process.exitCode = 1;
});