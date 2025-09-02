# classchart

## Example 1

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
    title: Demo Class Diagram
    ---
    classDiagram
      accTitle: Demo Class Diagram
      accDescr: This class diagram show the abstract Animal class, and 3 classes that inherit from it: Duck, Fish, and Zebra.

      Animal <|-- Duck
      Animal <|-- Fish
      Animal <|-- Zebra
      Animal : +int age
      Animal : +String gender
      Animal: +isMammal()
      Animal: +mate()

      class Duck{
        +String beakColor
        +swim()
        +quack()
      }
      class Fish{
        -Listint sizeInFeet
        -canEat()
      }
      class Zebra{
        +bool is_wild
        +run(List~T~, List~OT~)
        %% +run-composite(List~T, K~)
        +run-nested(List~List~OT~~)
      }
```

## Example 2

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
classDiagram
    Class01 <|-- AveryLongClass : Cool

    <<interface>> Class01
    Class03 "0" *-- "0..n" Class04
    Class05 "1" o-- "many" Class06
    Class07 .. Class08
    Class09 "many" --> "1" C2 : Where am i?
    Class09 "0" --* "1..n" C3
    Class09 --|> Class07
    Class07 : equals()
    Class07 : Object[] elementData
    Class01 : #size()
    Class01 : -int chimp
    Class01 : +int gorilla
    Class08 <--> C2: Cool label
      class Class10 {
      <<service>>
      int id
      size()
      }
```

## Example 3

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
classDiagram
    class Class01~T~
    Class01 : #size()
    Class01 : -int chimp
    Class01 : +int gorilla
    Class01 : +abstractAttribute string*
    class Class10~T~ {
    <<service>>
    int id
    size()
    }
```

## Example 4

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
classDiagram
    Class01~T~ <|-- AveryLongClass : Cool
    <<interface>> Class01
    Class03~T~ "0" *-- "0..n" Class04
    Class05 "1" o-- "many" Class06
    Class07~T~ .. Class08
    Class09 "many" --> "1" C2 : Where am i?
      Class09 "0" --* "1..n" C3
      Class09 --|> Class07
      Class07 : equals()
      Class07 : Object[] elementData
      Class01 : #size()
      Class01 : -int chimp
      Class01 : +int gorilla
      Class08 <--> C2: Cool label
        class Class10 {
        <<service>>
        int id
        size()
        }
```

## Example 5

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
classDiagram
    Interface1 ()-- Interface1Impl
```

## Example 6

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
classDiagram
    direction LR
    Animal ()-- Dog
    Animal ()-- Cat
    note for Cat "should have no members area"
    Dog : bark()
    Dog : species()
```

## Example 7

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
classDiagram
    direction RL
    Fruit ()-- Apple
    Apple : color()
    Apple : -int leafCount()
    Fruit ()-- Pineapple
    Pineapple : color()
    Pineapple : -int leafCount()
    Pineapple : -int spikeCount()
```

## Example 8

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
classDiagram
      class Person {
        +ID : Guid
        +FirstName : string
        +LastName : string
        -privateProperty : string
        #ProtectedProperty : string
        ~InternalProperty : string
        ~AnotherInternalProperty : List~List~string~~
      }
      class People List~List~Person~~
```

## Example 9

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
classDiagram
      namespace Company.Project.Module {
        class GenericClass~T~ {
          +addItem(item: T)
          +getItem() T
        }
      }
```

## Example 10

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
classDiagram
      namespace Company.Project.Module.SubModule {
        class Report {
          +generatePDF(data: List)
          +generateCSV(data: List)
        }
      }
      namespace Company.Project.Module {
        class Admin {
          +generateReport()
        }
      }
      Admin --> Report : generates
```

## Example 11

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
classDiagram
      namespace Company.Project.Module {
        class User {
          +login(username: String, password: String)
          +logout()
        }
        class Admin {
          +addUser(user: User)
          +removeUser(user: User)
          +generateReport()
        }
        class Report {
          +generatePDF(reportData: List)
          +generateCSV(reportData: List)
        }
      }
      Admin --> User : manages
      Admin --> Report : generates
```

## Example 12

**SebastianJS (SVG):**

> Render failed: TypeError: DOMPurify.sanitize is not a function

**Mermaid Code (Browser Rendered):**

```mermaid
classDiagram
      namespace Shapes {
        class Shape {
          +calculateArea() double
        }
        class Circle {
          +double radius
        }
        class Square {
          +double side
        }
      }

      Shape <|-- Circle
      Shape <|-- Square

      namespace Vehicles {
        class Vehicle {
          +String brand
        }
        class Car {
          +int horsepower
        }
        class Bike {
          +boolean hasGears
        }
      }

      Vehicle <|-- Car
      Vehicle <|-- Bike
      Car --> Circle : "Logo Shape"
      Bike --> Square : "Logo Shape"
```

