# Phone test plan

The paths to walk on a real phone before a build of a phone app goes to
testers. Walk them on one iPhone and one Android phone, against the hosted
preview, with the demo accounts. Each line is one path and what must be seen.
They come from the native journeys in `tools/native-e2e/journeys/`, which run
the same paths through the web export; a phone adds what the export cannot
check: the build starts, the secure store, fonts, permissions, the camera,
location in the background, gestures and the keyboard.

If a path fails, stop, fill in the "Problema encontrado" form (GitHub, New
issue) with the app, the version and the build number, and do not send the
build further. Never type a real customer's details into a test.

## Yuntera (shoppers)

1. Open the app: the home screen shows products and the category menu, with no error.
2. Search with a typo ("audifonos nimbo aire"): the earphones are found.
3. Open a product from a shared link: its page opens, with a way back to the shop.
4. Add it to the cart, go to pay while signed out: the app asks you to sign in.
5. Sign in with a wrong password, then the right one: one clear message, then the checkout.
6. Pay by SINPE Móvil and simulate the payment: the order shows its delivery code.
7. Close the app and open it again: you are still signed in and the order is in Pedidos.
8. Return a product of a delivered order: the app says it is collected first, then refunded.
9. Filter all products by one brand: only that brand's products, with their count.
10. Turn on WhatsApp in Su cuenta and give the commercial consent: both read back after reopening.
11. Ask for a password reset: the e-mail arrives and its link opens the shop's website.
12. Sign out with no connection, then reconnect: the app stays signed out.

## Yuntera Vende (sellers)

1. Sign in as the demo seller and choose Ferretería El Higuerón: today's work shows.
2. Change a price and a stock count: both are saved and read back.
3. Create a listing for ₡20 000 in Hogar, card, shipped by the seller: the fee preview gives ₡16 203,20.
4. Type a price below the fees: it is refused with the lowest price accepted.
5. Open the payouts screen: the account is masked and a wrong IBAN is refused.
6. Pack an order: it moves to packed.
7. Switch to the other shop: the first shop's messages are gone.
8. Open Inventario: the stock history shows a warehouse correction with its reason, never who.
9. Invite an account, accept on a second phone, then remove it: the list says so.
10. Sign in with an account that has an authenticator app: a wrong code says the tries left.
11. Lose the connection and try to send an invitation: it fails at once and nothing is sent later.
12. Open Su cuenta: the screen says why the account cannot be deleted while it runs the shop.

## Yuntera Ruta (drivers)

1. Sign in as the demo driver: route R-1003 and its stops show.
2. Start a route: our explanation comes before the phone's location question.
3. Allow the location: the position reaches the console within a minute.
4. Arrive at the cash stop and type a wrong code: it is refused with the attempts left.
5. Type the right code and the cash received: the change is counted and the stop is delivered.
6. Mark a stop as failed with a reason: it shows as failed.
7. Turn on airplane mode, arrive at a stop and mark one failed: "2 acciones por enviar".
8. Lock the phone for five minutes with the route open: the position keeps reaching the console.
9. Turn the connection back on: the queue empties once, in order, nothing twice.
10. Have Central remove a stop: it reads "Omitida" and says to bring the parcel back.
11. Have Central suspend the driver mid-route: the app says so and stops sharing the position.
12. Sign in with the shopper account: the app says it is not for that account.

## Yuntera Bodega (warehouse)

1. Sign in as the warehouse lead: the board shows parcels to pick.
2. Open a parcel and start picking: the pick list shows.
3. Scan a wrong code with the camera: it is refused where the worker is looking.
4. Scan the right codes with the camera, then with a hand scanner: each line is confirmed.
5. Pack the parcel: it moves to packed.
6. Receive a line a seller announced by scanning it: the units are added.
7. Count more units than announced: it is refused with the reason, nothing sent.
8. Open a shelf from Ubicaciones by scanning its code: its stock shows.
9. Move three units to another shelf: both shelves show the change.
10. Count a product onto an empty shelf with a reason: its card appears on the shelf.
11. Check in a parcel that came back: its condition is chosen by the worker, nothing pre-selected.
12. Sign out: nothing of the worker stays on the phone; the app opens on sign-in.
