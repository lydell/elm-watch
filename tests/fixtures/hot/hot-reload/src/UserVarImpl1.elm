module UserVarImpl1 exposing (main)

import Browser
import Html


{-| In optimize mode, this compiles to `var view = impl.title;`, just like
`var view = impl.view;` in `_Browser_element`.
-}
titleTwice : { title : String } -> String
titleTwice impl =
    let
        view =
            impl.title
    in
    view ++ view


main : Program () () ()
main =
    Browser.element
        { init = \() -> ( (), Cmd.none )
        , update = \() model -> ( model, Cmd.none )
        , subscriptions = always Sub.none
        , view =
            \() ->
                Html.text
                    (titleTwice { title = "title" }
                     -- ++ " hot reloaded"
                    )
        }
