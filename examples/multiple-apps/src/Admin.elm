module Admin exposing (main)

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


{-| The admin app owns `/admin` and everything below it.
-}
ownsPath : String -> Bool
ownsPath path =
    path == "/admin" || String.startsWith "/admin/" path


view : Shared.Model -> Browser.Document Shared.Msg
view model =
    case model.url.path of
        "/admin" ->
            Shared.document "Admin app: Dashboard" model []

        "/admin/users" ->
            Shared.document "Admin app: Users"
                model
                [ Html.ul []
                    [ Html.li [] [ Html.text "Alice" ]
                    , Html.li [] [ Html.text "Bob" ]
                    ]
                ]

        _ ->
            Shared.document "Admin app: Page not found" model []
