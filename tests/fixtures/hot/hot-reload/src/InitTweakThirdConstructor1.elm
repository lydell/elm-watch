module InitTweakThirdConstructor1 exposing (main)

import Browser
import Html exposing (Html)


{-| In optimize mode, `Third` gets `$: 2`, just like tasks made with
`_Scheduler_binding`, and its third argument is stored in `.c`.
-}
type Model
    = First
    | Second
    | Third Int Int Int


init : () -> ( Model, Cmd () )
init () =
    ( Third 1 2 3
      -- |> always (Third 1 2 4)
    , Cmd.none
    )


view : Model -> Html ()
view model =
    case model of
        Third a b c ->
            Html.text (String.fromInt a ++ String.fromInt b ++ String.fromInt c)

        _ ->
            Html.text "other"


main : Program () Model ()
main =
    Browser.element
        { init = init
        , update = \() model -> ( model, Cmd.none )
        , subscriptions = always Sub.none
        , view = view
        }
