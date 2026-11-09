module Main exposing (main)

import Browser
import Html
import Shared


main : Program () Shared.Model Shared.Msg
main =
    Browser.application
        { init = \() url key -> ( Shared.init url key, Cmd.none )
        , view = view
        , update = Shared.update ownsPath
        , subscriptions = \_ -> Sub.none
        , onUrlRequest = Shared.onUrlRequest
        , onUrlChange = Shared.onUrlChange
        }


{-| The main app owns all URLs, except the ones owned by the admin app.
-}
ownsPath : String -> Bool
ownsPath path =
    path /= "/admin" && not (String.startsWith "/admin/" path)


view : Shared.Model -> Browser.Document Shared.Msg
view model =
    case model.url.path of
        "/" ->
            Shared.document "Main app: Home" model []

        "/about" ->
            Shared.document "Main app: About"
                model
                [ Html.p [] [ Html.text "This is the main app." ] ]

        _ ->
            Shared.document "Main app: Page not found" model []
