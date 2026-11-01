function validateProfile(body) {
 if (!body || typeof body !== "object" || Array.isArray(body) ||
     Object.keys(body).some(key => !["full_name", "contact_phone"].includes(key))) {
   return { error: "Only full_name and contact_phone can be submitted." };
 }
 const { full_name, contact_phone } = body;
 if (typeof full_name !== "string" || !full_name.trim() || full_name.trim().length > 150 ||
     /[\u0000-\u001f\u007f]/.test(full_name)) {
   return { error: "Enter your full name using 1–150 characters." };
 }
 if (typeof contact_phone !== "string" || contact_phone.length > 40) {
   return { error: "Enter a contact phone number using 7–15 digits." };
 }
 const phone = contact_phone.trim().replace(/[ ()-]/g, "");
 if (!/^\+?[0-9]{7,15}$/.test(phone)) {
   return { error: "Use 7–15 digits, with an optional leading +. Spaces, brackets and hyphens are allowed." };
 }
 return { value: { full_name: full_name.trim(), contact_phone: phone } };
}
module.exports = { validateProfile };
