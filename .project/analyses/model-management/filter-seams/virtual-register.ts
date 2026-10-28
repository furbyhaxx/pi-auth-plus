export default function (pi) {
  pi.registerVirtualModel({ provider: "virtual-extra", id: "hidden", name: "Virtual hidden", route: () => { throw new Error("No requests in this probe"); } });
}
